import {
  CalendarExceptionSchema,
  ScheduleRuleSchema,
  type CalendarException,
  type ScheduleRule,
  type SecurityRoster,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import type {
  MonthlyReportRepository,
  MonthlyReportSource,
  MonthlyReportSourceAttendance,
  MonthlyReportSourceEarlyDeparture,
  MonthlyReportSourceLeave,
  MonthlyReportSourceTeacher,
} from './monthly-report.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

const PAGE_SIZE = 1000;
const ProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: z.string(),
  full_name: z.string(),
  whatsapp_number: z.string().nullable(),
  role: z.enum(['USER', 'SECURITY_GUARD']),
  created_at: z.string(),
});
const ScheduleRowSchema = z.strictObject({
  id: z.uuid(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']),
  check_in_open: z.string(),
  work_start: z.string(),
  check_in_close: z.string(),
  checkout_open: z.string(),
  work_end: z.string(),
  checkout_close: z.string(),
  target_minutes: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});
const CalendarRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  name: z.string(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
});
const AttendanceBaseRowSchema = z.strictObject({
  id: z.uuid(),
  teacher_id: z.uuid(),
  work_date: z.string(),
  check_in_at: z.string(),
  work_start: z.string(),
  work_end: z.string(),
  checkout_close: z.string(),
  target_minutes: z.number().int(),
  arrival_late_minutes: z.number().int(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY', 'SECURITY_DAY', 'SECURITY_NIGHT']),
  work_start_at: z.string(),
  work_end_at: z.string(),
});
const SecuritySettingsRowSchema = z.strictObject({
  id: z.uuid(), day_shift: z.unknown(), night_shift: z.unknown(),
  day_one_morning_guard_id: z.uuid(), day_one_night_guard_id: z.uuid(), day_one_off_guard_id: z.uuid(),
  effective_from: z.string(), effective_to: z.string().nullable(),
});
const AttendanceRowSchema = z.discriminatedUnion('status', [
  AttendanceBaseRowSchema.extend({
    status: z.literal('CHECKED_IN'),
    check_out_at: z.null(),
    worked_minutes: z.null(),
    work_deficit_minutes: z.null(),
  }),
  AttendanceBaseRowSchema.extend({
    status: z.literal('COMPLETED'),
    check_out_at: z.string(),
    worked_minutes: z.number().int(),
    work_deficit_minutes: z.number().int(),
  }),
]);
const LeaveRowSchema = z.strictObject({
  teacher_id: z.uuid(),
  leave_date: z.string(),
  leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL']),
  status: z.enum(['PENDING', 'APPROVED']),
});
const EarlyDepartureRowSchema = z.strictObject({
  attendance_id: z.uuid(),
  teacher_id: z.uuid(),
  work_date: z.string(),
  requested_at: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
});
const ReportingSettingsRowSchema = z.strictObject({
  operational_start_date: z.string(),
});

const SCHEDULE_FIELDS =
  'id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to';
const ATTENDANCE_FIELDS =
  'id,teacher_id,work_date,check_in_at,check_out_at,work_start,work_end,checkout_close,target_minutes,worked_minutes,arrival_late_minutes,work_deficit_minutes,status,schedule_type,work_start_at,work_end_at';

interface PageResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

async function loadAllPages(
  fetchPage: (from: number, to: number) => Promise<PageResult>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new AppError(
        500,
        'MONTHLY_REPORT_LOOKUP_FAILED',
        'Data laporan bulanan tidak dapat dimuat',
      );
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function time(value: string): string {
  return value.slice(0, 5);
}

function jakartaDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextDate(workDate: string): string {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1))
    .toISOString()
    .slice(0, 10);
}

function toTeacher(value: unknown): MonthlyReportSourceTeacher {
  const row = ProfileRowSchema.parse(value);
  return {
    teacherId: row.id,
    teacherNip: row.nip,
    teacherFullName: row.full_name,
    role: row.role,
    teacherWhatsapp: row.whatsapp_number,
    createdDate: jakartaDate(row.created_at),
  };
}

function toSchedule(value: unknown): ScheduleRule {
  const row = ScheduleRowSchema.parse(value);
  return ScheduleRuleSchema.parse({
    id: row.id,
    scheduleType: row.schedule_type,
    checkInOpen: time(row.check_in_open),
    workStart: time(row.work_start),
    checkInClose: time(row.check_in_close),
    checkoutOpen: time(row.checkout_open),
    workEnd: time(row.work_end),
    checkoutClose: time(row.checkout_close),
    targetMinutes: row.target_minutes,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  });
}

function toCalendarException(value: unknown): CalendarException {
  const row = CalendarRowSchema.parse(value);
  return CalendarExceptionSchema.parse({
    id: row.id,
    workDate: row.work_date,
    exceptionType: row.exception_type,
    name: row.name,
    scheduleType: row.schedule_type,
  });
}

function toAttendance(value: unknown): MonthlyReportSourceAttendance {
  const row = AttendanceRowSchema.parse(value);
  const common = {
    id: row.id,
    teacherId: row.teacher_id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    workStart: time(row.work_start),
    workEnd: time(row.work_end),
    checkoutClose: time(row.checkout_close),
    targetMinutes: row.target_minutes,
    arrivalLateMinutes: row.arrival_late_minutes,
    scheduleType: row.schedule_type,
    workStartAt: row.work_start_at,
    workEndAt: row.work_end_at,
  };
  return row.status === 'COMPLETED'
    ? {
        ...common,
        status: row.status,
        checkOutAt: row.check_out_at,
        workedMinutes: row.worked_minutes,
        workDeficitMinutes: row.work_deficit_minutes,
      }
    : {
        ...common,
        status: row.status,
        checkOutAt: null,
        workedMinutes: null,
        workDeficitMinutes: null,
      };
}

function toLeave(value: unknown): MonthlyReportSourceLeave {
  const row = LeaveRowSchema.parse(value);
  return {
    teacherId: row.teacher_id,
    leaveDate: row.leave_date,
    leaveType: row.leave_type,
    status: row.status,
  };
}

function toEarlyDeparture(value: unknown): MonthlyReportSourceEarlyDeparture {
  const row = EarlyDepartureRowSchema.parse(value);
  return {
    attendanceId: row.attendance_id,
    teacherId: row.teacher_id,
    workDate: row.work_date,
    requestedAt: row.requested_at,
    status: row.status,
  };
}

export class SupabaseMonthlyReportRepository
  implements MonthlyReportRepository
{
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async loadMonth(startDate: string, endDate: string): Promise<MonthlyReportSource> {
    const nextMonthDate = nextDate(endDate);
    const [
      teacherRows,
      scheduleRows,
      securitySettingsRows,
      calendarRows,
      attendanceRows,
      leaveRows,
      earlyDepartureRows,
      reportingSettingsResult,
    ] = await Promise.all([
      loadAllPages(async (from, to) =>
        this.client
          .from('profiles')
          .select('id,nip,full_name,whatsapp_number,role,created_at')
          .in('role', ['USER', 'SECURITY_GUARD'])
          .eq('is_active', true)
          .lt('created_at', `${nextMonthDate}T00:00:00+07:00`)
          .order('full_name', { ascending: true })
          .order('nip', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('schedule_rules')
          .select(SCHEDULE_FIELDS)
          .lte('effective_from', endDate)
          .or(`effective_to.is.null,effective_to.gte.${startDate}`)
          .order('effective_from', { ascending: true })
          .order('schedule_type', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('security_schedule_settings')
          .select('id,day_shift,night_shift,day_one_morning_guard_id,day_one_night_guard_id,day_one_off_guard_id,effective_from,effective_to')
          .lte('effective_from', endDate)
          .or(`effective_to.is.null,effective_to.gte.${startDate}`)
          .order('effective_from', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('calendar_exceptions')
          .select('id,work_date,exception_type,name,schedule_type')
          .gte('work_date', startDate)
          .lte('work_date', endDate)
          .order('work_date', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('attendance_records')
          .select(ATTENDANCE_FIELDS)
          .gte('work_date', startDate)
          .lte('work_date', endDate)
          .order('work_date', { ascending: true })
          .order('teacher_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('leave_requests')
          .select('teacher_id,leave_date,leave_type,status')
          .gte('leave_date', startDate)
          .lte('leave_date', endDate)
          .in('status', ['PENDING', 'APPROVED'])
          .order('leave_date', { ascending: true })
          .order('teacher_id', { ascending: true })
          .range(from, to),
      ),
      loadAllPages(async (from, to) =>
        this.client
          .from('early_departure_requests')
          .select('attendance_id,teacher_id,work_date,requested_at,status')
          .gte('work_date', startDate)
          .lte('work_date', endDate)
          .order('work_date', { ascending: true })
          .order('teacher_id', { ascending: true })
          .range(from, to),
      ),
      this.client
        .from('reporting_settings')
        .select('operational_start_date')
        .eq('singleton', true)
        .maybeSingle(),
    ]);

    if (reportingSettingsResult.error) {
      throw new AppError(
        500,
        'MONTHLY_REPORT_LOOKUP_FAILED',
        'Pengaturan laporan bulanan tidak dapat dimuat',
      );
    }
    const operationalStartDate = reportingSettingsResult.data
      ? ReportingSettingsRowSchema.parse(reportingSettingsResult.data).operational_start_date
      : null;

    const teachers = teacherRows.map(toTeacher);
    const teacherIds = new Set(teachers.map((teacher) => teacher.teacherId));
    return {
      teachers,
      schedules: scheduleRows.map(toSchedule),
      securitySettings: securitySettingsRows.map((value) => {
        const row = SecuritySettingsRowSchema.parse(value);
        const roster: SecurityRoster = {
          dayOneMorningGuardId: row.day_one_morning_guard_id,
          dayOneNightGuardId: row.day_one_night_guard_id,
          dayOneOffGuardId: row.day_one_off_guard_id,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
        };
        const schedule = (input: unknown, scheduleType: 'SECURITY_DAY' | 'SECURITY_NIGHT') =>
          ScheduleRuleSchema.parse({ id: row.id, scheduleType, ...(input as object), effectiveFrom: row.effective_from, effectiveTo: row.effective_to });
        return { dayShift: schedule(row.day_shift, 'SECURITY_DAY'), nightShift: schedule(row.night_shift, 'SECURITY_NIGHT'), roster };
      }),
      calendarExceptions: calendarRows.map(toCalendarException),
      attendances: attendanceRows
        .map(toAttendance)
        .filter((attendance) => teacherIds.has(attendance.teacherId)),
      leaves: leaveRows
        .map(toLeave)
        .filter((leave) => teacherIds.has(leave.teacherId)),
      earlyDepartures: earlyDepartureRows
        .map(toEarlyDeparture)
        .filter((request) => teacherIds.has(request.teacherId)),
      operationalStartDate,
    };
  }
}
