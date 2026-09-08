import {
  AdminAttendanceListResponseSchema,
  CreateAttendanceAdminNoteSchema,
  AttendanceAdminNoteSchema,
  ListAdminAttendanceQuerySchema,
  type AdminAttendanceListResponse,
  type AdminAttendanceRecord,
  type AdminAttendanceStatus,
  type AttendanceAdminNote,
  type CalendarException,
  type CreateAttendanceAdminNote,
  type LeaveType,
  type ListAdminAttendanceQuery,
  type AuthUser,
  type SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import type { Express, Request } from 'express';
import { z } from 'zod';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';
import { resolveCalendarDay } from './calendar-payroll.js';
import { resolveSecurityAssignment } from './security-duty.js';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const AttendanceIdSchema = z.uuid();

export interface AdminAttendanceSourceAttendance {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  checkoutClose: string;
  checkoutCloseAt?: string;
  targetMinutes: number;
  workedMinutes: number | null;
  workDeficitMinutes: number | null;
  arrivalLateMinutes: number;
  status: 'CHECKED_IN' | 'COMPLETED';
  scheduleType?: 'WEEKDAY' | 'SATURDAY' | 'SECURITY_DAY' | 'SECURITY_NIGHT';
}

export interface AdminAttendanceSource {
  teacherId: string;
  teacherNip: string;
  teacherFullName: string;
  role?: 'USER' | 'SECURITY_GUARD';
  attendance: AdminAttendanceSourceAttendance | null;
  approvedLeave: { leaveType: LeaveType } | null;
  notes: AttendanceAdminNote[];
}

export interface AdminAttendanceRepository {
  findCalendarException(workDate: string): Promise<CalendarException | null>;
  findSecuritySchedules?(workDate: string): Promise<SecurityScheduleSettingsResponse>;
  listDailySources(
    workDate: string,
    search?: string,
  ): Promise<AdminAttendanceSource[]>;
  attendanceExists(attendanceId: string): Promise<boolean>;
  createNote(
    attendanceId: string,
    createdBy: string,
    input: CreateAttendanceAdminNote,
  ): Promise<AttendanceAdminNote>;
}

export interface AdminAttendanceService {
  list(input: ListAdminAttendanceQuery): Promise<AdminAttendanceListResponse>;
  addNote(
    actorId: string,
    attendanceId: string,
    input: CreateAttendanceAdminNote,
  ): Promise<AttendanceAdminNote>;
}

interface JakartaDateTime {
  workDate: string;
  minuteOfDay: number;
  timestampMs: number;
}

function jakartaDateTime(value: Date): JakartaDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    workDate: `${part('year')}-${part('month')}-${part('day')}`,
    minuteOfDay: Number(part('hour')) * 60 + Number(part('minute')),
    timestampMs: value.getTime(),
  };
}

function timeMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function isIncomplete(
  attendance: AdminAttendanceSourceAttendance,
  selectedWorkDate: string,
  current: JakartaDateTime,
): boolean {
  if (attendance.status === 'CHECKED_IN' && attendance.checkoutCloseAt) {
    return new Date(attendance.checkoutCloseAt).getTime() < current.timestampMs;
  }
  return (
    attendance.status === 'CHECKED_IN' &&
    (selectedWorkDate < current.workDate ||
      (selectedWorkDate === current.workDate &&
        current.minuteOfDay > timeMinutes(attendance.checkoutClose)))
  );
}

function toRecord(
  source: AdminAttendanceSource,
  workDate: string,
  current: JakartaDateTime,
  securityDuty?: { isWorkingDay: boolean; scheduleType: 'SECURITY_DAY' | 'SECURITY_NIGHT' | null },
): AdminAttendanceRecord {
  const attendance = source.attendance;
  let status: AdminAttendanceStatus;
  if (source.role === 'SECURITY_GUARD' && securityDuty && !securityDuty.isWorkingDay && !attendance) {
    status = 'OFF';
  } else if (attendance) {
    status = isIncomplete(attendance, workDate, current)
      ? 'INCOMPLETE'
      : attendance.arrivalLateMinutes > 0
        ? 'LATE'
        : 'PRESENT';
  } else {
    status = source.approvedLeave ? 'LEAVE' : 'NOT_PRESENT';
  }

  const incomplete = attendance && status === 'INCOMPLETE';
  return {
    teacherId: source.teacherId,
    teacherNip: source.teacherNip,
    teacherFullName: source.teacherFullName,
    role: source.role,
    scheduleType: attendance?.scheduleType ?? securityDuty?.scheduleType ?? null,
    workDate,
    status,
    attendanceId: attendance?.id ?? null,
    checkInAt: attendance?.checkInAt ?? null,
    checkOutAt: attendance?.checkOutAt ?? null,
    workedMinutes: status === 'OFF'
      ? 0
      : incomplete
      ? Math.max(0, attendance.targetMinutes - 60)
      : (attendance?.workedMinutes ?? null),
    workDeficitMinutes: status === 'OFF'
      ? 0
      : incomplete
      ? Math.min(60, attendance.targetMinutes)
      : (attendance?.workDeficitMinutes ?? null),
    arrivalLateMinutes: status === 'OFF' ? 0 : (attendance?.arrivalLateMinutes ?? null),
    leaveType: source.approvedLeave?.leaveType ?? null,
    notes: attendance ? source.notes : [],
  };
}

function emptySummary(workDate: string, generatedAt: string) {
  return {
    workDate,
    generatedAt,
    present: 0,
    late: 0,
    notPresent: 0,
    incomplete: 0,
    leave: 0,
    off: 0,
    total: 0,
  };
}

function summaryFor(
  records: AdminAttendanceRecord[],
  workDate: string,
  generatedAt: string,
) {
  const summary = emptySummary(workDate, generatedAt);
  for (const record of records) {
    if (record.status === 'PRESENT') summary.present += 1;
    if (record.status === 'LATE') summary.late += 1;
    if (record.status === 'NOT_PRESENT') summary.notPresent += 1;
    if (record.status === 'INCOMPLETE') summary.incomplete += 1;
    if (record.status === 'LEAVE') summary.leave += 1;
    if (record.status === 'OFF') summary.off += 1;
  }
  summary.total = records.length;
  return summary;
}

export function createAdminAttendanceService(
  repository: AdminAttendanceRepository,
  now: () => Date = () => new Date(),
): AdminAttendanceService {
  return {
    async list(input) {
      const serverNow = now();
      const current = jakartaDateTime(serverNow);
      const workDate = input.workDate ?? current.workDate;
      const exception = await repository.findCalendarException(workDate);
      const day = resolveCalendarDay(workDate, exception);
      const sources = await repository.listDailySources(workDate, input.search);
      const securitySettings = sources.some(
        (source) => source.role === 'SECURITY_GUARD' && !source.attendance,
      )
        ? await repository.findSecuritySchedules?.(workDate)
        : undefined;
      const records = sources
        .filter((source) => day.isWorkingDay || source.role === 'SECURITY_GUARD')
        .map((source) => {
          if (source.role !== 'SECURITY_GUARD' || !securitySettings?.roster) {
            return toRecord(source, workDate, current);
          }
          const assignment = resolveSecurityAssignment(
            securitySettings.roster,
            workDate,
            source.teacherId,
          );
          return toRecord(source, workDate, current, {
            isWorkingDay: assignment.status === 'DAY' || assignment.status === 'NIGHT',
            scheduleType: assignment.status === 'DAY'
              ? 'SECURITY_DAY'
              : assignment.status === 'NIGHT'
                ? 'SECURITY_NIGHT'
                : null,
          });
        })
        .sort(
          (left, right) =>
            left.teacherFullName.localeCompare(right.teacherFullName, 'id') ||
            left.teacherNip.localeCompare(right.teacherNip, 'id'),
        );
      const filtered = input.status
        ? records.filter((record) => record.status === input.status)
        : records;
      const start = (input.page - 1) * input.pageSize;
      const totalItems = filtered.length;

      return AdminAttendanceListResponseSchema.parse({
        summary: summaryFor(records, workDate, serverNow.toISOString()),
        data: filtered.slice(start, start + input.pageSize),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / input.pageSize),
        },
      });
    },

    async addNote(actorId, attendanceId, input) {
      if (!(await repository.attendanceExists(attendanceId))) {
        throw new AppError(
          404,
          'ATTENDANCE_NOT_FOUND',
          'Data absensi tidak ditemukan',
        );
      }
      return AttendanceAdminNoteSchema.parse(
        await repository.createNote(attendanceId, actorId, input),
      );
    },
  };
}

function actorId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  }
  return user.id;
}

function attendanceId(value: unknown): string {
  const parsed = AttendanceIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ID absensi tidak valid');
  }
  return parsed.data;
}

export function registerAdminAttendanceRoutes(
  app: Express,
  authService: AuthService,
  attendanceService: AdminAttendanceService,
): void {
  const adminGuards = [
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
  ];

  app.get(
    '/api/admin/attendance',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = ListAdminAttendanceQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Parameter monitoring absensi tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(await attendanceService.list(parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/attendance/:id/notes',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = CreateAttendanceAdminNoteSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Catatan admin tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(201).json({
          note: await attendanceService.addNote(
            actorId(request),
            attendanceId(request.params['id']),
            parsed.data,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
