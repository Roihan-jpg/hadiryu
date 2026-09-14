import {
  DefaultReportPeriodSchema,
  MonthlyReportPreviewSchema,
  MonthlyReportReadinessSchema,
  MonthlyReportParamsSchema,
  type CalendarException,
  type LeaveType,
  type MonthlyReportDay,
  type MonthlyReportIssue,
  type MonthlyReportParams,
  type MonthlyReportPreview,
  type MonthlyReportReadiness,
  type MonthlyReportReadinessIssue,
  type ScheduleRule,
  type SecurityRoster,
} from '@absensi/contracts';
import type { Express } from 'express';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';
import { resolveCalendarDay } from './calendar-payroll.js';
import { resolveSecurityAssignment } from './security-duty.js';
import { adjustedAttendanceMetrics } from './attendance-adjustments.js';

export interface MonthlyReportSourceTeacher {
  teacherId: string;
  teacherNip: string;
  teacherFullName: string;
  role?: 'USER' | 'SECURITY_GUARD';
  teacherWhatsapp?: string | null;
  createdDate: string;
}

interface MonthlyReportSourceAttendanceBase {
  id: string;
  teacherId: string;
  workDate: string;
  checkInAt: string;
  workStart: string;
  workEnd: string;
  checkoutClose: string;
  targetMinutes: number;
  arrivalLateMinutes: number;
  scheduleType?: ScheduleRule['scheduleType'];
  workStartAt?: string;
  workEndAt?: string;
}

export type MonthlyReportSourceAttendance =
  | (MonthlyReportSourceAttendanceBase & {
      status: 'CHECKED_IN';
      checkOutAt: null;
      workedMinutes: null;
      workDeficitMinutes: null;
    })
  | (MonthlyReportSourceAttendanceBase & {
      status: 'COMPLETED';
      checkOutAt: string;
      workedMinutes: number;
      workDeficitMinutes: number;
    });

export interface MonthlyReportSourceLeave {
  teacherId: string;
  leaveDate: string;
  leaveType: LeaveType;
  status: 'PENDING' | 'APPROVED';
}

export interface MonthlyReportSourceEarlyDeparture {
  attendanceId: string;
  teacherId: string;
  workDate: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface MonthlyReportSource {
  teachers: MonthlyReportSourceTeacher[];
  schedules: ScheduleRule[];
  calendarExceptions: CalendarException[];
  attendances: MonthlyReportSourceAttendance[];
  leaves: MonthlyReportSourceLeave[];
  earlyDepartures: MonthlyReportSourceEarlyDeparture[];
  operationalStartDate?: string | null;
  securitySettings?: Array<{
    dayShift: ScheduleRule;
    nightShift: ScheduleRule;
    roster: SecurityRoster;
  }>;
}

export interface MonthlyReportRepository {
  loadMonth(startDate: string, endDate: string): Promise<MonthlyReportSource>;
}

export interface MonthlyReportService {
  readiness(input: MonthlyReportParams): Promise<MonthlyReportReadiness>;
  preview(input: MonthlyReportParams): Promise<MonthlyReportPreview>;
}

interface ResolvedReportDay {
  workDate: string;
  schedule: ScheduleRule | null;
  scheduleType: ScheduleRule['scheduleType'] | null;
  calendarExceptionName: string | null;
  configurationMissing: boolean;
}

function reportDates(year: number, month: number): string[] {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: days },
    (_, index) =>
      `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
  );
}

function effectiveSchedule(
  schedules: readonly ScheduleRule[],
  scheduleType: ScheduleRule['scheduleType'],
  workDate: string,
): ScheduleRule | null {
  return (
    schedules
      .filter(
        (schedule) =>
          schedule.scheduleType === scheduleType &&
          schedule.effectiveFrom <= workDate &&
          (schedule.effectiveTo === null || workDate <= schedule.effectiveTo),
      )
      .sort((left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom),
      )[0] ?? null
  );
}

function effectiveSecuritySettings(
  source: MonthlyReportSource,
  workDate: string,
): NonNullable<MonthlyReportSource['securitySettings']>[number] | null {
  return (
    source.securitySettings
      ?.filter(
        (item) =>
          item.roster.effectiveFrom <= workDate &&
          (item.roster.effectiveTo === null || workDate <= item.roster.effectiveTo),
      )
      .sort((left, right) =>
        right.roster.effectiveFrom.localeCompare(left.roster.effectiveFrom),
      )[0] ?? null
  );
}

function nextLocalDate(workDate: string): string {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
}

function missingRanges(
  dates: readonly string[],
): Array<{ startDate: string; endDate: string }> {
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  for (const workDate of dates) {
    const current = ranges.at(-1);
    if (current && nextLocalDate(current.endDate) === workDate) {
      current.endDate = workDate;
    } else {
      ranges.push({ startDate: workDate, endDate: workDate });
    }
  }
  return ranges;
}

function isRelevantOnDate(
  teacher: MonthlyReportSourceTeacher,
  workDate: string,
  operationalStartDate?: string | null,
): boolean {
  return teacher.createdDate <= workDate &&
    (operationalStartDate === null || operationalStartDate === undefined ||
      operationalStartDate <= workDate);
}

function buildReadiness(
  input: MonthlyReportParams,
  dates: readonly string[],
  source: MonthlyReportSource,
): MonthlyReportReadiness {
  const exceptionByDate = new Map(
    source.calendarExceptions.map((exception) => [exception.workDate, exception]),
  );
  const schoolMissingDates = dates.filter((workDate) => {
    const hasRelevantTeacher = source.teachers.some(
      (teacher) =>
        teacher.role !== 'SECURITY_GUARD' &&
        isRelevantOnDate(teacher, workDate, source.operationalStartDate),
    );
    if (!hasRelevantTeacher) return false;
    const calendarDay = resolveCalendarDay(
      workDate,
      exceptionByDate.get(workDate) ?? null,
    );
    return (
      calendarDay.isWorkingDay &&
      calendarDay.scheduleType !== null &&
      effectiveSchedule(source.schedules, calendarDay.scheduleType, workDate) === null
    );
  });
  const securityMissingDates = dates.filter((workDate) => {
    const hasRelevantGuard = source.teachers.some(
      (teacher) =>
        teacher.role === 'SECURITY_GUARD' &&
        isRelevantOnDate(teacher, workDate, source.operationalStartDate),
    );
    return hasRelevantGuard && effectiveSecuritySettings(source, workDate) === null;
  });
  const issues: MonthlyReportReadinessIssue[] = [];
  if (schoolMissingDates.length > 0) {
    issues.push({
      code: 'SCHOOL_SCHEDULE_COVERAGE_MISSING',
      source: 'SCHOOL_SCHEDULE',
      missingRanges: missingRanges(schoolMissingDates),
    });
  }
  if (securityMissingDates.length > 0) {
    issues.push({
      code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
      source: 'SECURITY_SCHEDULE',
      missingRanges: missingRanges(securityMissingDates),
    });
  }
  return MonthlyReportReadinessSchema.parse({
    status: issues.length === 0 ? 'READY' : 'READY_WITH_WARNINGS',
    year: input.year,
    month: input.month,
    startDate: dates[0]!,
    endDate: dates.at(-1)!,
    issues,
  });
}

function resolveReportDays(
  dates: readonly string[],
  source: MonthlyReportSource,
): ResolvedReportDay[] {
  const exceptionByDate = new Map(
    source.calendarExceptions.map((exception) => [exception.workDate, exception]),
  );
  return dates.map((workDate) => {
    const exception = exceptionByDate.get(workDate) ?? null;
    const calendarDay = resolveCalendarDay(workDate, exception);
    const hasRelevantTeacher = source.teachers.some(
      (teacher) =>
        teacher.role !== 'SECURITY_GUARD' &&
        isRelevantOnDate(teacher, workDate, source.operationalStartDate),
    );
    if (
      !hasRelevantTeacher ||
      !calendarDay.isWorkingDay ||
      calendarDay.scheduleType === null
    ) {
      return {
        workDate,
        schedule: null,
        scheduleType: null,
        calendarExceptionName: exception?.name ?? null,
        configurationMissing: false,
      };
    }
    const schedule = effectiveSchedule(
      source.schedules,
      calendarDay.scheduleType,
      workDate,
    );
    return {
      workDate,
      schedule,
      scheduleType: calendarDay.scheduleType,
      calendarExceptionName: exception?.name ?? null,
      configurationMissing: schedule === null,
    };
  });
}

function resolveTeacherReportDays(
  dates: readonly string[],
  source: MonthlyReportSource,
  teacher: MonthlyReportSourceTeacher,
  schoolDays: readonly ResolvedReportDay[],
): ResolvedReportDay[] {
  if (teacher.role !== 'SECURITY_GUARD') {
    return schoolDays.map((day) =>
      isRelevantOnDate(teacher, day.workDate, source.operationalStartDate)
        ? day
        : {
            workDate: day.workDate,
            schedule: null,
            scheduleType: null,
            calendarExceptionName: null,
            configurationMissing: false,
          },
    );
  }
  return dates.map((workDate) => {
    if (!isRelevantOnDate(teacher, workDate, source.operationalStartDate)) {
      return {
        workDate,
        schedule: null,
        scheduleType: null,
        calendarExceptionName: null,
        configurationMissing: false,
      };
    }
    const settings = effectiveSecuritySettings(source, workDate);
    if (!settings) {
      return {
        workDate,
        schedule: null,
        scheduleType: null,
        calendarExceptionName: null,
        configurationMissing: true,
      };
    }
    const assignment = resolveSecurityAssignment(settings.roster, workDate, teacher.teacherId);
    if (assignment.status === 'OFF' || assignment.status === 'UNASSIGNED') {
      return { workDate, schedule: null, scheduleType: null, calendarExceptionName: null, configurationMissing: false };
    }
    const schedule = assignment.status === 'DAY' ? settings.dayShift : settings.nightShift;
    return { workDate, schedule, scheduleType: schedule.scheduleType, calendarExceptionName: null, configurationMissing: false };
  });
}

function sourceKey(teacherId: string, workDate: string): string {
  return `${teacherId}:${workDate}`;
}

function nonWorkingDay(day: ResolvedReportDay): MonthlyReportDay {
  return {
    workDate: day.workDate,
    scheduleType: null,
    status: 'NON_WORKING_DAY',
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: null,
    workEnd: null,
    targetMinutes: 0,
    workedMinutes: 0,
    arrivalLateMinutes: 0,
    workDeficitMinutes: 0,
    leaveType: null,
    calendarExceptionName: day.calendarExceptionName,
  };
}

function configurationMissingDay(day: ResolvedReportDay): MonthlyReportDay {
  return {
    workDate: day.workDate,
    scheduleType: day.scheduleType,
    status: 'CONFIGURATION_MISSING',
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: null,
    workEnd: null,
    targetMinutes: null,
    workedMinutes: null,
    arrivalLateMinutes: null,
    workDeficitMinutes: null,
    leaveType: null,
    calendarExceptionName: day.calendarExceptionName,
  };
}

function jakartaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function checkoutCloseAt(attendance: MonthlyReportSourceAttendance): Date {
  const closeDate = attendance.scheduleType === 'SECURITY_NIGHT'
    ? nextLocalDate(attendance.workDate)
    : attendance.workDate;
  return new Date(`${closeDate}T${attendance.checkoutClose}:00+07:00`);
}

function withLiveUserSchedule<T extends MonthlyReportSourceAttendance>(
  attendance: T,
  schedule: ScheduleRule,
): T {
  const instant = (time: string) => new Date(
    `${attendance.workDate}T${time}:00+07:00`,
  ).toISOString();
  return {
    ...attendance,
    workStart: schedule.workStart,
    workEnd: schedule.workEnd,
    checkoutClose: schedule.checkoutClose,
    targetMinutes: schedule.targetMinutes,
    scheduleType: schedule.scheduleType,
    workStartAt: instant(schedule.workStart),
    workEndAt: instant(schedule.workEnd),
  } as T;
}

function attendanceDay(
  day: ResolvedReportDay,
  attendance: MonthlyReportSourceAttendance,
  lateArrivalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | null,
  earlyDeparture: MonthlyReportSourceEarlyDeparture | undefined,
  generatedAt: Date,
): MonthlyReportDay {
  const adjusted = adjustedAttendanceMetrics(attendance, {
    lateArrivalStatus,
    earlyDepartureStatus: earlyDeparture?.status ?? null,
  });
  const common = {
    workDate: day.workDate,
    scheduleType: attendance.scheduleType ?? day.scheduleType!,
    attendanceId: attendance.id,
    checkInAt: attendance.checkInAt,
    workStart: attendance.workStart,
    workEnd: attendance.workEnd,
    targetMinutes: attendance.targetMinutes,
    arrivalLateMinutes: adjusted.arrivalLateMinutes,
    leaveType: null,
    calendarExceptionName: day.calendarExceptionName,
  };
  if (attendance.status === 'COMPLETED') {
    const rejectedWorkedMinutes = earlyDeparture?.status === 'REJECTED'
      ? Math.min(
          adjusted.workedMinutes ?? 0,
          Math.max(
            0,
            attendance.targetMinutes -
              rejectedEarlyDepartureMinutes(
                earlyDeparture.requestedAt,
                attendance.workEnd,
                attendance.targetMinutes,
                attendance.workEndAt,
              ),
          ),
        )
      : adjusted.workedMinutes ?? attendance.workedMinutes;
    const effectiveWorkedMinutes = rejectedWorkedMinutes ?? 0;
    return {
      ...common,
      status: 'WORKED',
      checkOutAt: attendance.checkOutAt,
      workedMinutes: effectiveWorkedMinutes,
      workDeficitMinutes: Math.max(0, attendance.targetMinutes - effectiveWorkedMinutes),
    };
  }
  if (generatedAt <= checkoutCloseAt(attendance)) {
    return {
      ...common,
      status: 'IN_PROGRESS',
      checkOutAt: null,
      workedMinutes: null,
      workDeficitMinutes: null,
    };
  }
  return {
    ...common,
    status: 'INCOMPLETE',
    checkOutAt: null,
    workedMinutes: Math.max(0, attendance.targetMinutes - 60),
    workDeficitMinutes: Math.min(60, attendance.targetMinutes),
  };
}

function rejectedEarlyDepartureMinutes(
  requestedAt: string,
  workEnd: string,
  maximumMinutes: number,
  workEndAt?: string,
): number {
  if (workEndAt) {
    return Math.min(maximumMinutes, Math.max(0, Math.floor(
      (new Date(workEndAt).getTime() - new Date(requestedAt).getTime()) / 60_000,
    )));
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(requestedAt));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const requestedMinute = value('hour') * 60 + value('minute');
  const [endHour = '0', endMinute = '0'] = workEnd.split(':');
  return Math.min(
    maximumMinutes,
    Math.max(
      0,
      Number(endHour) * 60 + Number(endMinute) - requestedMinute,
    ),
  );
}

function scheduledDay(
  day: ResolvedReportDay,
  leave: MonthlyReportSourceLeave | undefined,
  today: string,
): MonthlyReportDay {
  const schedule = day.schedule!;
  const common = {
    workDate: day.workDate,
    scheduleType: day.scheduleType!,
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: schedule.workStart,
    workEnd: schedule.workEnd,
    targetMinutes: schedule.targetMinutes,
    arrivalLateMinutes: 0 as const,
    calendarExceptionName: day.calendarExceptionName,
  };
  if (leave) {
    return {
      ...common,
      status: 'LEAVE',
      workedMinutes: schedule.targetMinutes,
      workDeficitMinutes: 0,
      leaveType: leave.leaveType,
    };
  }
  if (day.workDate >= today) {
    return {
      ...common,
      status: 'NOT_YET_OCCURRED',
      workedMinutes: null,
      arrivalLateMinutes: null,
      workDeficitMinutes: null,
      leaveType: null,
    };
  }
  return {
    ...common,
    status: 'ABSENT',
    workedMinutes: 0,
    workDeficitMinutes: schedule.targetMinutes,
    leaveType: null,
  };
}

export function createMonthlyReportService(
  repository: MonthlyReportRepository,
  now: () => Date = () => new Date(),
): MonthlyReportService {
  return {
    async readiness(input) {
      const dates = reportDates(input.year, input.month);
      const source = await repository.loadMonth(dates[0]!, dates.at(-1)!);
      return buildReadiness(input, dates, source);
    },
    async preview(input) {
      const dates = reportDates(input.year, input.month);
      const startDate = dates[0]!;
      const endDate = dates.at(-1)!;
      const source = await repository.loadMonth(startDate, endDate);
      const generatedAt = now();
      const today = jakartaDate(generatedAt);
      const readiness = buildReadiness(input, dates, source);

      const resolvedDays = resolveReportDays(dates, source);
      const attendanceByTeacherDate = new Map(
        source.attendances.map((attendance) => [
          sourceKey(attendance.teacherId, attendance.workDate),
          attendance,
        ]),
      );
      const approvedLeaveByTeacherDate = new Map(
        source.leaves
          .filter((leave) => leave.status === 'APPROVED' && leave.leaveType !== 'LATE_ARRIVAL')
          .map((leave) => [sourceKey(leave.teacherId, leave.leaveDate), leave]),
      );
      const lateArrivalByTeacherDate = new Map(
        source.leaves
          .filter(
            (leave) =>
              leave.leaveType === 'LATE_ARRIVAL' &&
              (leave.status === 'PENDING' || leave.status === 'APPROVED'),
          )
          .map((leave) => [sourceKey(leave.teacherId, leave.leaveDate), leave.status]),
      );
      const pendingLeaveByTeacherDate = new Map(
        source.leaves
          .filter((leave) => leave.status === 'PENDING')
          .map((leave) => [sourceKey(leave.teacherId, leave.leaveDate), leave]),
      );
      const earlyDepartureByAttendanceId = new Map(
        source.earlyDepartures.map((request) => [request.attendanceId, request]),
      );
      const issues: MonthlyReportIssue[] = readiness.issues.map((issue) => ({
        category: 'CONFIGURATION',
        ...issue,
      }));
      if (endDate >= today) {
        issues.push({
          category: 'PERIOD',
          code: 'REPORT_PERIOD_IN_PROGRESS',
          currentDate: today,
          periodEndDate: endDate,
        });
      }
      const teachers = [...source.teachers]
        .sort(
          (left, right) =>
            left.teacherFullName.localeCompare(right.teacherFullName, 'id') ||
            left.teacherNip.localeCompare(right.teacherNip, 'id'),
        )
        .map((teacher) => {
          const teacherDays = resolveTeacherReportDays(dates, source, teacher, resolvedDays);
          const days = teacherDays.map((day) => {
            const attendance = attendanceByTeacherDate.get(
              sourceKey(teacher.teacherId, day.workDate),
            );
            if (attendance) {
              return attendanceDay(
                day,
                teacher.role !== 'SECURITY_GUARD' && day.schedule
                  ? withLiveUserSchedule(attendance, day.schedule)
                  : attendance,
                lateArrivalByTeacherDate.get(sourceKey(teacher.teacherId, day.workDate)) ?? null,
                earlyDepartureByAttendanceId.get(attendance.id),
                generatedAt,
              );
            }
            if (day.configurationMissing) return configurationMissingDay(day);
            if (!day.schedule) return nonWorkingDay(day);
            return scheduledDay(
              day,
              approvedLeaveByTeacherDate.get(
                sourceKey(teacher.teacherId, day.workDate),
              ),
              today,
            );
          });
          for (const day of days) {
            if (day.workDate >= today) continue;
            const key = sourceKey(teacher.teacherId, day.workDate);
            const pendingLeave = pendingLeaveByTeacherDate.get(key);
            const attendance = attendanceByTeacherDate.get(key);
            const pendingEarlyDeparture = attendance
              ? earlyDepartureByAttendanceId.get(attendance.id)?.status === 'PENDING'
              : source.earlyDepartures.some((request) =>
                  request.teacherId === teacher.teacherId &&
                  request.workDate === day.workDate &&
                  request.status === 'PENDING')
                ? true
                : false;
            const commonIssue = {
              category: 'STAFF_DATA' as const,
              teacherId: teacher.teacherId,
              teacherNip: teacher.teacherNip,
              teacherFullName: teacher.teacherFullName,
              teacherRole: teacher.role ?? 'USER' as const,
              teacherWhatsapp: teacher.teacherWhatsapp ?? null,
              workDate: day.workDate,
            };
            if (pendingLeave) {
              issues.push({ ...commonIssue, code: 'PENDING_LEAVE' });
            } else if (pendingEarlyDeparture) {
              issues.push({ ...commonIssue, code: 'PENDING_EARLY_DEPARTURE' });
            } else if (day.status === 'INCOMPLETE') {
              issues.push({ ...commonIssue, code: 'INCOMPLETE_ATTENDANCE' });
            } else if (day.status === 'ABSENT') {
              issues.push({ ...commonIssue, code: 'NO_ATTENDANCE' });
            }
          }
          const totalWorkDeficitMinutes = days.reduce(
            (total, day) => total + (day.workDeficitMinutes ?? 0),
            0,
          );
          const lateDayCount = days.filter(
            (day) => (day.arrivalLateMinutes ?? 0) > 0,
          ).length;
          const absentDayCount = days.filter(
            (day) => day.status === 'ABSENT',
          ).length;
          const rejectedEarlyDepartureMinutesTotal = days.reduce(
            (total, day) => {
              if (!day.attendanceId || day.workEnd === null || day.targetMinutes === null) return total;
              const request = earlyDepartureByAttendanceId.get(day.attendanceId);
              return request?.status === 'REJECTED'
                ? total +
                    rejectedEarlyDepartureMinutes(
                      request.requestedAt,
                      day.workEnd,
                      day.targetMinutes,
                      source.attendances.find((attendance) => attendance.id === day.attendanceId)?.workEndAt,
                    )
                : total;
            },
            0,
          );
          return {
            teacherId: teacher.teacherId,
            teacherNip: teacher.teacherNip,
            teacherFullName: teacher.teacherFullName,
            role: teacher.role,
            days,
            totalWorkDeficitMinutes,
            lateDayCount,
            absentDayCount,
            rejectedEarlyDepartureMinutes: rejectedEarlyDepartureMinutesTotal,
          };
        });

      return MonthlyReportPreviewSchema.parse({
        year: input.year,
        month: input.month,
        startDate,
        endDate,
        generatedAt: generatedAt.toISOString(),
        documentStatus: issues.length === 0 ? 'FINAL' : 'DRAFT',
        issues,
        teachers,
      });
    },
  };
}

export function registerMonthlyReportRoutes(
  app: Express,
  authService: AuthService,
  monthlyReportService: MonthlyReportService,
): void {
  app.get(
    '/api/admin/reports/default-period',
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
    (_request, response) => {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric',
      }).formatToParts(new Date());
      const value = (type: 'year' | 'month') => Number(parts.find((part) => part.type === type)?.value);
      response.status(200).json(DefaultReportPeriodSchema.parse({ year: value('year'), month: value('month') }));
    },
  );
  app.get(
    '/api/admin/reports/monthly/:year/:month/readiness',
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
    async (request, response, next) => {
      try {
        const parsed = MonthlyReportParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Periode laporan bulanan tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(await monthlyReportService.readiness(parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );
  app.get(
    '/api/admin/reports/monthly/:year/:month/preview',
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
    async (request, response, next) => {
      try {
        const parsed = MonthlyReportParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Periode laporan bulanan tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(await monthlyReportService.preview(parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );
}
