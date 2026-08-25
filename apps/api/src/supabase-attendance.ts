import {
  CalendarExceptionSchema,
  CheckInRecordSchema,
  GeofenceRuleSchema,
  ScheduleRuleSchema,
  type CalendarException,
  type CheckInRecord,
  type GeofenceRule,
  type ScheduleRule,
  type ScheduleType,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import type {
  AttendanceRepository,
  SaveCheckInInput,
} from './attendance.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

const NumericValueSchema = z.union([z.number(), z.string()]);
const AttendanceRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  check_in_at: z.string(),
  check_in_latitude: NumericValueSchema,
  check_in_longitude: NumericValueSchema,
  check_in_accuracy_meters: NumericValueSchema,
  check_in_distance_meters: NumericValueSchema,
  work_start: z.string(),
  work_end: z.string(),
  checkout_close: z.string(),
  target_minutes: z.number().int(),
  arrival_late_minutes: z.number().int(),
  status: z.literal('CHECKED_IN'),
});
const CalendarRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  name: z.string(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
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
const GeofenceRowSchema = z.strictObject({
  id: z.uuid(),
  latitude: NumericValueSchema,
  longitude: NumericValueSchema,
  radius_meters: z.number().int(),
  max_accuracy_meters: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});

const ATTENDANCE_FIELDS =
  'id,work_date,check_in_at,check_in_latitude,check_in_longitude,check_in_accuracy_meters,check_in_distance_meters,work_start,work_end,checkout_close,target_minutes,arrival_late_minutes,status';
const SCHEDULE_FIELDS =
  'id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to';
const GEOFENCE_FIELDS =
  'id,latitude,longitude,radius_meters,max_accuracy_meters,effective_from,effective_to';

function time(value: string): string {
  return value.slice(0, 5);
}

function toAttendance(value: unknown): CheckInRecord {
  const row = AttendanceRowSchema.parse(value);
  return CheckInRecordSchema.parse({
    id: row.id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    latitude: Number(row.check_in_latitude),
    longitude: Number(row.check_in_longitude),
    accuracyMeters: Number(row.check_in_accuracy_meters),
    distanceMeters: Number(row.check_in_distance_meters),
    workStart: time(row.work_start),
    workEnd: time(row.work_end),
    checkoutClose: time(row.checkout_close),
    targetMinutes: row.target_minutes,
    arrivalLateMinutes: row.arrival_late_minutes,
    status: row.status,
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

function toGeofence(value: unknown): GeofenceRule {
  const row = GeofenceRowSchema.parse(value);
  return GeofenceRuleSchema.parse({
    id: row.id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusMeters: row.radius_meters,
    maxAccuracyMeters: row.max_accuracy_meters,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  });
}

function lookupError(message: string): AppError {
  return new AppError(500, 'ATTENDANCE_LOOKUP_FAILED', message);
}

export class SupabaseAttendanceRepository implements AttendanceRepository {
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

  async findAttendance(
    teacherId: string,
    workDate: string,
  ): Promise<CheckInRecord | null> {
    const { data, error } = await this.client
      .from('attendance_records')
      .select(ATTENDANCE_FIELDS)
      .eq('teacher_id', teacherId)
      .eq('work_date', workDate)
      .maybeSingle();
    if (error) throw lookupError('Status absensi hari ini tidak dapat dimuat');
    return data ? toAttendance(data) : null;
  }

  async findCalendarException(workDate: string): Promise<CalendarException | null> {
    const { data, error } = await this.client
      .from('calendar_exceptions')
      .select('id,work_date,exception_type,name,schedule_type')
      .eq('work_date', workDate)
      .maybeSingle();
    if (error) throw lookupError('Kalender sekolah tidak dapat dimuat');
    return data ? toCalendarException(data) : null;
  }

  async findSchedule(
    scheduleType: ScheduleType,
    workDate: string,
  ): Promise<ScheduleRule | null> {
    const { data, error } = await this.client
      .from('schedule_rules')
      .select(SCHEDULE_FIELDS)
      .eq('schedule_type', scheduleType)
      .lte('effective_from', workDate)
      .or(`effective_to.is.null,effective_to.gte.${workDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw lookupError('Jadwal absensi tidak dapat dimuat');
    return data ? toSchedule(data) : null;
  }

  async findGeofence(workDate: string): Promise<GeofenceRule | null> {
    const { data, error } = await this.client
      .from('geofence_rules')
      .select(GEOFENCE_FIELDS)
      .lte('effective_from', workDate)
      .or(`effective_to.is.null,effective_to.gte.${workDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw lookupError('Lokasi sekolah tidak dapat dimuat');
    return data ? toGeofence(data) : null;
  }

  async hasApprovedLeave(teacherId: string, workDate: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('leave_requests')
      .select('id')
      .eq('teacher_id', teacherId)
      .eq('leave_date', workDate)
      .eq('status', 'APPROVED')
      .limit(1)
      .maybeSingle();
    if (error) throw lookupError('Status izin tidak dapat dimuat');
    return data !== null;
  }

  async saveCheckIn(input: SaveCheckInInput): Promise<CheckInRecord> {
    const { data, error } = await this.client
      .from('attendance_records')
      .insert({
        teacher_id: input.teacherId,
        work_date: input.workDate,
        check_in_at: input.checkInAt,
        check_in_latitude: input.location.latitude,
        check_in_longitude: input.location.longitude,
        check_in_accuracy_meters: input.location.accuracyMeters,
        check_in_distance_meters: input.distanceMeters,
        work_start: input.schedule.workStart,
        work_end: input.schedule.workEnd,
        checkout_close: input.schedule.checkoutClose,
        target_minutes: input.schedule.targetMinutes,
        arrival_late_minutes: input.arrivalLateMinutes,
        status: 'CHECKED_IN',
      })
      .select(ATTENDANCE_FIELDS)
      .single();
    if (!error && data) return toAttendance(data);
    if (error?.code === '23505') {
      const existing = await this.findAttendance(input.teacherId, input.workDate);
      if (existing) return existing;
    }
    throw new AppError(
      500,
      'ATTENDANCE_SAVE_FAILED',
      'Check-in tidak dapat disimpan',
    );
  }
}
