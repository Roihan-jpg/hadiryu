import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import { jakartaDateTime } from './attendance.js';
import type {
  DashboardAttendanceSource,
  DashboardChartDay,
  DashboardStreakDay,
  StaffDashboardRepository,
  StaffDashboardSource,
} from './staff-dashboard.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

const AttendanceRowSchema = z.strictObject({
  id: z.uuid(), work_date: z.string(), check_in_at: z.string(), check_out_at: z.string().nullable(),
  work_start: z.string(), work_end: z.string(), work_start_at: z.string(), work_end_at: z.string(),
  checkout_close_at: z.string(), target_minutes: z.number().int(), worked_minutes: z.number().int().nullable(),
  work_deficit_minutes: z.number().int().nullable(), arrival_late_minutes: z.number().int(),
  status: z.enum(['CHECKED_IN', 'COMPLETED']),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY', 'SECURITY_DAY', 'SECURITY_NIGHT']),
});
const LeaveRowSchema = z.strictObject({
  id: z.uuid(), leave_date: z.string(), leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL', 'MATERNITY_LEAVE']),
  reason: z.string(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  decision_note: z.string().nullable(), created_at: z.string(), attachment_original_name: z.string().nullable(),
  attachment_mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']).nullable(), attachment_size_bytes: z.number().int().nullable(),
  full_leave_end_date: z.string().nullable().optional(), early_departure_start_date: z.string().nullable().optional(), early_departure_end_date: z.string().nullable().optional(),
});
const EarlyRowSchema = z.strictObject({
  id: z.uuid(), attendance_id: z.uuid(), work_date: z.string(), requested_at: z.string(), reason: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']), decision_note: z.string().nullable(),
  attachment_original_name: z.string().nullable(), attachment_mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']).nullable(),
  attachment_size_bytes: z.number().int().nullable(),
});
const ScheduleRowSchema = z.strictObject({
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']), check_in_close: z.string(),
  work_start: z.string(), work_end: z.string(), checkout_close: z.string(), target_minutes: z.number().int(),
  effective_from: z.string(), effective_to: z.string().nullable(),
});
const CalendarRowSchema = z.strictObject({
  work_date: z.string(), exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
});
const ProfileRowSchema = z.strictObject({ created_at: z.string() });
const ReportingRowSchema = z.strictObject({ operational_start_date: z.string() });

const ATTENDANCE_FIELDS = 'id,work_date,check_in_at,check_out_at,work_start,work_end,work_start_at,work_end_at,checkout_close_at,target_minutes,worked_minutes,work_deficit_minutes,arrival_late_minutes,status,schedule_type';
const LEAVE_FIELDS = 'id,leave_date,leave_type,reason,status,decision_note,created_at,attachment_original_name,attachment_mime_type,attachment_size_bytes,full_leave_end_date,early_departure_start_date,early_departure_end_date';
const EARLY_FIELDS = 'id,attendance_id,work_date,requested_at,reason,status,decision_note,attachment_original_name,attachment_mime_type,attachment_size_bytes';

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, value!, 1));
  return date.toISOString().slice(0, 10);
}

function addDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function maxDate(left: string, right: string | null): string {
  return right && right > left ? right : left;
}

function attachment(row: { attachment_original_name: string | null; attachment_mime_type: 'application/pdf' | 'image/jpeg' | 'image/png' | null; attachment_size_bytes: number | null }) {
  if (!row.attachment_original_name || !row.attachment_mime_type || row.attachment_size_bytes === null) return null;
  return { originalName: row.attachment_original_name, mimeType: row.attachment_mime_type, sizeBytes: row.attachment_size_bytes };
}

function lookupFailure(): AppError {
  return new AppError(500, 'DASHBOARD_LOOKUP_FAILED', 'Data dashboard belum dapat dimuat');
}

function scheduleFor(rows: z.infer<typeof ScheduleRowSchema>[], workDate: string, type: 'WEEKDAY' | 'SATURDAY') {
  return rows.find((row) => row.schedule_type === type && row.effective_from <= workDate && (!row.effective_to || row.effective_to >= workDate));
}

function jakartaInstant(workDate: string, time: string): string {
  return new Date(`${workDate}T${time.slice(0, 5)}:00+07:00`).toISOString();
}

function defaultScheduleType(workDate: string): 'WEEKDAY' | 'SATURDAY' | null {
  const day = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? null : day === 6 ? 'SATURDAY' : 'WEEKDAY';
}

export class SupabaseStaffDashboardRepository implements StaffDashboardRepository {
  private readonly client: SupabaseClient;
  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  }

  async load(staff: { id: string; role: 'USER' | 'SECURITY_GUARD' }, month: string, serverNow: Date): Promise<StaffDashboardSource> {
    const monthStart = `${month}-01`;
    const monthEnd = nextMonth(month);
    const today = jakartaDateTime(serverNow).workDate;
    const [profileResult, reportingResult, latestEarlyResult] = await Promise.all([
      this.client.from('profiles').select('created_at').eq('id', staff.id).single(),
      this.client.from('reporting_settings').select('operational_start_date').eq('singleton', true).maybeSingle(),
      this.client.from('early_departure_requests').select(EARLY_FIELDS).eq('teacher_id', staff.id).order('requested_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (profileResult.error || reportingResult.error || latestEarlyResult.error) throw lookupFailure();
    const createdDate = jakartaDateTime(new Date(ProfileRowSchema.parse(profileResult.data).created_at)).workDate;
    const operationalStart = reportingResult.data ? ReportingRowSchema.parse(reportingResult.data).operational_start_date : null;
    const streakStart = operationalStart ? (createdDate > operationalStart ? createdDate : operationalStart) : createdDate;
    const rangeStart = staff.role === 'USER' && streakStart < monthStart ? streakStart : monthStart;
    const rangeEnd = monthEnd > addDate(today, 1) ? monthEnd : addDate(today, 1);

    const [attendanceResult, leaveResult, earlyResult, schedulesResult, calendarResult] = await Promise.all([
      this.client.from('attendance_records').select(ATTENDANCE_FIELDS).eq('teacher_id', staff.id).gte('work_date', rangeStart).lt('work_date', rangeEnd).order('work_date', { ascending: false }).limit(5000),
      this.client.from('leave_requests').select(LEAVE_FIELDS).eq('teacher_id', staff.id).lt('leave_date', rangeEnd).or(`leave_date.gte.${rangeStart},early_departure_end_date.gte.${rangeStart}`).order('created_at', { ascending: false }).limit(5000),
      this.client.from('early_departure_requests').select(EARLY_FIELDS).eq('teacher_id', staff.id).gte('work_date', monthStart).lt('work_date', monthEnd).order('requested_at', { ascending: false }).limit(5000),
      staff.role === 'USER' ? this.client.from('schedule_rules').select('schedule_type,check_in_close,work_start,work_end,checkout_close,target_minutes,effective_from,effective_to').in('schedule_type', ['WEEKDAY', 'SATURDAY']).lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${streakStart}`).order('effective_from', { ascending: false }).limit(5000) : Promise.resolve({ data: [], error: null }),
      staff.role === 'USER' ? this.client.from('calendar_exceptions').select('work_date,exception_type,schedule_type').gte('work_date', streakStart).lte('work_date', today).limit(5000) : Promise.resolve({ data: [], error: null }),
    ]);
    if (attendanceResult.error || leaveResult.error || earlyResult.error || schedulesResult.error || calendarResult.error) throw lookupFailure();
    const attendanceRows = (attendanceResult.data ?? []).map((row) => AttendanceRowSchema.parse(row));
    const leaveRows = (leaveResult.data ?? []).map((row) => LeaveRowSchema.parse(row));
    const earlyRows = (earlyResult.data ?? []).map((row) => EarlyRowSchema.parse(row));
    const schedules = (schedulesResult.data ?? []).map((row) => ScheduleRowSchema.parse(row));
    const calendars = new Map((calendarResult.data ?? []).map((row) => { const item = CalendarRowSchema.parse(row); return [item.work_date, item] as const; }));
    const latestLateByDate = new Map<string, z.infer<typeof LeaveRowSchema>>();
    for (const row of leaveRows) if (row.leave_type === 'LATE_ARRIVAL' && !latestLateByDate.has(row.leave_date)) latestLateByDate.set(row.leave_date, row);
    const earlyByAttendance = new Map(earlyRows.map((row) => [row.attendance_id, row]));

    const allAttendance: DashboardAttendanceSource[] = attendanceRows.map((row) => {
      const exception = calendars.get(row.work_date);
      const scheduleType = exception?.exception_type === 'WORKING_DAY'
        ? exception.schedule_type
        : defaultScheduleType(row.work_date);
      const liveSchedule = staff.role === 'USER' && scheduleType
        ? scheduleFor(schedules, row.work_date, scheduleType)
        : null;
      const targetMinutes = liveSchedule?.target_minutes ?? row.target_minutes;
      const checkoutCloseAt = liveSchedule
        ? jakartaInstant(row.work_date, liveSchedule.checkout_close)
        : row.checkout_close_at;
      const expired = row.status === 'CHECKED_IN' && serverNow.getTime() > new Date(checkoutCloseAt).getTime();
      const maternityEarlyCredit = staff.role === 'USER' && row.status === 'CHECKED_IN' && leaveRows.some((leave) =>
        leave.leave_type === 'MATERNITY_LEAVE' && leave.status === 'APPROVED' &&
        leave.early_departure_start_date && leave.early_departure_end_date &&
        row.work_date >= leave.early_departure_start_date && row.work_date <= leave.early_departure_end_date &&
        (row.work_date < today || (row.work_date === today && jakartaDateTime(serverNow).minuteOfDay >= 14 * 60)),
      );
      return {
        id: row.id, workDate: row.work_date, checkInAt: row.check_in_at, checkOutAt: row.check_out_at,
        workStart: (liveSchedule?.work_start ?? row.work_start).slice(0, 5),
        workEnd: (liveSchedule?.work_end ?? row.work_end).slice(0, 5),
        workStartAt: liveSchedule ? jakartaInstant(row.work_date, liveSchedule.work_start) : row.work_start_at,
        workEndAt: liveSchedule ? jakartaInstant(row.work_date, liveSchedule.work_end) : row.work_end_at,
        targetMinutes,
        workedMinutes: maternityEarlyCredit ? targetMinutes : expired ? Math.max(0, targetMinutes - 60) : row.worked_minutes,
        workDeficitMinutes: maternityEarlyCredit ? 0 : expired ? Math.min(60, targetMinutes) : row.status === 'COMPLETED' && row.worked_minutes !== null
          ? Math.max(0, targetMinutes - row.worked_minutes)
          : row.work_deficit_minutes,
        arrivalLateMinutes: row.arrival_late_minutes, status: expired ? 'INCOMPLETE' : row.status,
        scheduleType: liveSchedule?.schedule_type ?? row.schedule_type, lateArrivalStatus: latestLateByDate.get(row.work_date)?.status ?? null,
        earlyDepartureStatus: earlyByAttendance.get(row.id)?.status ?? null,
      };
    });
    const monthAttendance = allAttendance.filter((row) => row.workDate >= monthStart && row.workDate < monthEnd);
    const leaves = leaveRows.filter((row) => row.leave_date >= monthStart && row.leave_date < monthEnd).map((row) => ({
      type: 'LEAVE' as const, id: row.id, workDate: row.leave_date, occurredAt: row.created_at,
      leaveType: row.leave_type, status: row.status, reason: row.reason, decisionNote: row.decision_note, attachment: attachment(row),
    }));
    const earlyDepartures = earlyRows.map((row) => ({
      type: 'EARLY_DEPARTURE' as const, id: row.id, workDate: row.work_date, occurredAt: row.requested_at,
      status: row.status, reason: row.reason, decisionNote: row.decision_note, attachment: attachment(row),
    }));
    const toEarly = (value: unknown) => {
      if (!value) return null;
      const row = EarlyRowSchema.parse(value);
      return { type: 'EARLY_DEPARTURE' as const, id: row.id, workDate: row.work_date, occurredAt: row.requested_at,
        status: row.status, reason: row.reason, decisionNote: row.decision_note, attachment: attachment(row) };
    };

    const attendanceByDate = new Map(allAttendance.map((row) => [row.workDate, row]));
    const approvedAbsence = new Set(leaveRows.filter((row) => row.leave_type !== 'LATE_ARRIVAL' && row.leave_type !== 'MATERNITY_LEAVE' && row.status === 'APPROVED').map((row) => row.leave_date));
    for (const row of leaveRows) {
      if (row.leave_type !== 'MATERNITY_LEAVE' || row.status !== 'APPROVED' || !row.full_leave_end_date) continue;
      for (let date = row.leave_date > rangeStart ? row.leave_date : rangeStart; date <= row.full_leave_end_date && date < rangeEnd; date = addDate(date, 1)) {
        approvedAbsence.add(date);
      }
    }
    const streakDays: DashboardStreakDay[] = [];
    if (staff.role === 'USER') {
      for (let date = today; date >= streakStart; date = addDate(date, -1)) {
        const exception = calendars.get(date);
        const type = exception?.exception_type === 'HOLIDAY' ? null : exception?.exception_type === 'WORKING_DAY' ? exception.schedule_type : defaultScheduleType(date);
        if (!type || approvedAbsence.has(date)) { streakDays.push({ workDate: date, kind: 'PAUSE', attendance: null }); continue; }
        const schedule = scheduleFor(schedules, date, type);
        if (!schedule) { streakDays.push({ workDate: date, kind: 'CONFIGURATION_MISSING', attendance: null }); continue; }
        const attendance = attendanceByDate.get(date);
        if (date === today && !attendance) {
          const currentMinute = jakartaDateTime(serverNow).minuteOfDay;
          const [hours, minutes] = schedule.check_in_close.slice(0, 5).split(':').map(Number);
          if (currentMinute <= hours! * 60 + minutes!) { streakDays.push({ workDate: date, kind: 'OPEN', attendance: null }); continue; }
        }
        streakDays.push({ workDate: date, kind: 'WORKING', attendance: attendance ? {
          actualLateMinutes: attendance.arrivalLateMinutes, lateArrivalStatus: attendance.lateArrivalStatus,
        } : null });
      }
    }
    const chartStart = maxDate(createdDate, operationalStart);
    const chartDays: DashboardChartDay[] = [];
    if (staff.role === 'USER') {
      for (let date = monthStart; date < monthEnd; date = addDate(date, 1)) {
        const absence = leaveRows.find((row) => row.leave_type !== 'LATE_ARRIVAL' && (
          row.leave_type === 'MATERNITY_LEAVE'
            ? Boolean(row.full_leave_end_date && date >= row.leave_date && date <= row.full_leave_end_date)
            : row.leave_date === date
        ));
        const exception = calendars.get(date);
        const scheduleType = exception?.exception_type === 'HOLIDAY' ? null
          : exception?.exception_type === 'WORKING_DAY' ? exception.schedule_type
            : defaultScheduleType(date);
        const schedule = scheduleType ? scheduleFor(schedules, date, scheduleType) : null;
        const status = date < chartStart ? 'NOT_TRACKED'
          : date > today ? 'FUTURE'
            : absence?.status === 'PENDING' ? 'LEAVE_PENDING'
              : absence?.status === 'APPROVED' ? 'LEAVE_APPROVED'
                : absence?.status === 'REJECTED' ? 'LEAVE_REJECTED'
                  : !scheduleType ? 'NON_WORKING_DAY'
                    : !schedule ? 'CONFIGURATION_MISSING'
                      : date === today && jakartaDateTime(serverNow).minuteOfDay <= Number(schedule.check_in_close.slice(0, 2)) * 60 + Number(schedule.check_in_close.slice(3, 5)) ? 'OPEN'
                        : 'ABSENT';
        chartDays.push({ workDate: date, status, targetMinutes: schedule?.target_minutes ?? null });
      }
    }

    return { attendances: monthAttendance, leaves, earlyDepartures, latestEarlyDeparture: toEarly(latestEarlyResult.data), chartDays, streakDays };
  }
}
