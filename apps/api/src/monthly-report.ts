import {
  DefaultReportPeriodSchema,
  MonthlyReportPreviewSchema,
  MonthlyReportReadinessSchema,
  MonthlyReportParamsSchema,
  type CalendarException,
  type LeaveType,
  type MonthlyReportDay,
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

export interface MonthlyReportSourceTeacher {
  teacherId: string;
  teacherNip: string;
  teacherFullName: string;
  role?: 'USER' | 'SECURITY_GUARD';
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
): boolean {
  return teacher.createdDate <= workDate;
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
        teacher.role !== 'SECURITY_GUARD' && isRelevantOnDate(teacher, workDate),
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
        teacher.role === 'SECURITY_GUARD' && isRelevantOnDate(teacher, workDate),
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
    status: issues.length === 0 ? 'READY' : 'BLOCKED',
    year: input.year,
    month: input.month,
    startDate: dates[0]!,
    endDate: dates.at(-1)!,
    issues,
  });
}

function assertReportReady(readiness: MonthlyReportReadiness): void {
  if (readiness.status === 'READY') return;
  throw new AppError(
    422,
    'REPORT_CONFIGURATION_MISSING',
    'Konfigurasi laporan belum tersedia untuk seluruh periode',
    { issues: readiness.issues },
  );
}

function configurationMissing(message: string, workDate: string): AppError {
  return new AppError(422, 'REPORT_CONFIGURATION_MISSING', message, { workDate });
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
        teacher.role !== 'SECURITY_GUARD' && isRelevantOnDate(teacher, workDate),
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
      };
    }
    const schedule = effectiveSchedule(
      source.schedules,
      calendarDay.scheduleType,
      workDate,
    );
    if (!schedule) {
      throw configurationMissing(
        `Jadwal ${calendarDay.scheduleType} belum tersedia untuk periode laporan`,
        workDate,
      );
    }
    return {
      workDate,
      schedule,
      scheduleType: calendarDay.scheduleType,
      calendarExceptionName: exception?.name ?? null,
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
      isRelevantOnDate(teacher, day.workDate)
        ? day
        : {
            workDate: day.workDate,
            schedule: null,
            scheduleType: null,
            calendarExceptionName: null,
          },
    );
  }
  return dates.map((workDate) => {
    if (!isRelevantOnDate(teacher, workDate)) {
      return {
        workDate,
        schedule: null,
        scheduleType: null,
        calendarExceptionName: null,
      };
    }
    const settings = effectiveSecuritySettings(source, workDate);
    if (!settings) throw configurationMissing('Jadwal Satpam belum tersedia untuk periode laporan', workDate);
    const assignment = resolveSecurityAssignment(settings.roster, workDate, teacher.teacherId);
    if (assignment.status === 'OFF' || assignment.status === 'UNASSIGNED') {
      return { workDate, schedule: null, scheduleType: null, calendarExceptionName: null };
    }
    const schedule = assignment.status === 'DAY' ? settings.dayShift : settings.nightShift;
    return { workDate, schedule, scheduleType: schedule.scheduleType, calendarExceptionName: null };
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

function attendanceDay(
  day: ResolvedReportDay,
  attendance: MonthlyReportSourceAttendance,
  earlyDeparture: MonthlyReportSourceEarlyDeparture | undefined,
): MonthlyReportDay {
  const common = {
    workDate: day.workDate,
    scheduleType: attendance.scheduleType ?? day.scheduleType!,
    attendanceId: attendance.id,
    checkInAt: attendance.checkInAt,
    workStart: attendance.workStart,
    workEnd: attendance.workEnd,
    targetMinutes: attendance.targetMinutes,
    arrivalLateMinutes: attendance.arrivalLateMinutes,
    leaveType: null,
    calendarExceptionName: day.calendarExceptionName,
  };
  if (attendance.status === 'COMPLETED') {
    if (earlyDeparture?.status === 'APPROVED') {
      return {
        ...common,
        status: 'WORKED',
        checkOutAt: attendance.checkOutAt,
        workedMinutes: attendance.targetMinutes,
        workDeficitMinutes: 0,
      };
    }
    if (earlyDeparture?.status === 'REJECTED') {
      const emptyMinutes = rejectedEarlyDepartureMinutes(
        earlyDeparture.requestedAt,
        attendance.workEnd,
        attendance.targetMinutes,
        attendance.workEndAt,
      );
      return {
        ...common,
        status: 'WORKED',
        checkOutAt: attendance.checkOutAt,
        workedMinutes: Math.max(0, attendance.targetMinutes - emptyMinutes),
        workDeficitMinutes: emptyMinutes,
      };
    }
    return {
      ...common,
      status: 'WORKED',
      checkOutAt: attendance.checkOutAt,
      workedMinutes: attendance.workedMinutes,
      workDeficitMinutes: attendance.workDeficitMinutes,
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
      assertReportReady(buildReadiness(input, dates, source));
      const pendingLeaveCount = source.leaves.filter(
        (leave) => leave.status === 'PENDING',
      ).length;
      if (pendingLeaveCount > 0) {
        throw new AppError(
          409,
          'PENDING_LEAVE_EXISTS',
          'Selesaikan seluruh izin Pending sebelum membuat laporan',
          { pendingLeaveCount },
        );
      }
      const pendingEarlyDepartureCount = source.earlyDepartures.filter(
        (request) => request.status === 'PENDING',
      ).length;
      if (pendingEarlyDepartureCount > 0) {
        throw new AppError(
          409,
          'PENDING_EARLY_DEPARTURE_EXISTS',
          'Selesaikan seluruh permohonan pulang awal Pending sebelum membuat laporan',
          { pendingEarlyDepartureCount },
        );
      }

      const resolvedDays = resolveReportDays(dates, source);
      const attendanceByTeacherDate = new Map(
        source.attendances.map((attendance) => [
          sourceKey(attendance.teacherId, attendance.workDate),
          attendance,
        ]),
      );
      const approvedLeaveByTeacherDate = new Map(
        source.leaves
          .filter((leave) => leave.status === 'APPROVED')
          .map((leave) => [sourceKey(leave.teacherId, leave.leaveDate), leave]),
      );
      const earlyDepartureByAttendanceId = new Map(
        source.earlyDepartures.map((request) => [request.attendanceId, request]),
      );
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
                attendance,
                earlyDepartureByAttendanceId.get(attendance.id),
              );
            }
            if (!day.schedule) return nonWorkingDay(day);
            return scheduledDay(
              day,
              approvedLeaveByTeacherDate.get(
                sourceKey(teacher.teacherId, day.workDate),
              ),
            );
          });
          const totalWorkDeficitMinutes = days.reduce(
            (total, day) => total + day.workDeficitMinutes,
            0,
          );
          const lateDayCount = days.filter(
            (day) => day.arrivalLateMinutes > 0,
          ).length;
          const absentDayCount = days.filter(
            (day) => day.status === 'ABSENT',
          ).length;
          const rejectedEarlyDepartureMinutesTotal = days.reduce(
            (total, day) => {
              if (!day.attendanceId || day.workEnd === null) return total;
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
        generatedAt: now().toISOString(),
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
