import {
  CalendarExceptionSchema,
  CheckInRecordSchema,
  CompletedAttendanceRecordSchema,
  GeofenceRuleSchema,
  ScheduleRuleSchema,
  SecurityScheduleSettingsResponseSchema,
  type CalendarException,
  type CompletedAttendanceRecord,
  type GeofenceRule,
  type ListAttendanceHistoryQuery,
  type ScheduleRule,
  type ScheduleType,
  type SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import type {
  AttendanceRepository,
  PersistedAttendanceRecord,
  SaveCheckInInput,
  SaveCheckoutInput,
} from './attendance.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';
import { securityRotationPreview } from './security-duty.js';

const NumericValueSchema = z.union([z.number(), z.string()]);
const AttendanceRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  check_in_at: z.string(),
  check_in_latitude: NumericValueSchema,
  check_in_longitude: NumericValueSchema,
  check_in_accuracy_meters: NumericValueSchema,
  check_in_distance_meters: NumericValueSchema,
  check_in_boundary_clearance_meters: NumericValueSchema.nullable(),
  check_out_at: z.string().nullable(),
  check_out_latitude: NumericValueSchema.nullable(),
  check_out_longitude: NumericValueSchema.nullable(),
  check_out_accuracy_meters: NumericValueSchema.nullable(),
  check_out_distance_meters: NumericValueSchema.nullable(),
  check_out_boundary_clearance_meters: NumericValueSchema.nullable(),
  work_start: z.string(),
  work_end: z.string(),
  checkout_close: z.string(),
  target_minutes: z.number().int(),
  worked_minutes: z.number().int().nullable(),
  arrival_late_minutes: z.number().int(),
  work_deficit_minutes: z.number().int().nullable(),
  status: z.enum(['CHECKED_IN', 'COMPLETED']),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY', 'SECURITY_DAY', 'SECURITY_NIGHT']),
  check_in_open_at: z.string(),
  work_start_at: z.string(),
  check_in_close_at: z.string(),
  checkout_open_at: z.string(),
  work_end_at: z.string(),
  checkout_close_at: z.string(),
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
  polygon_vertices: z.unknown().nullable(),
  max_accuracy_meters: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});
const SecurityScheduleRowSchema = z.strictObject({
  id: z.uuid(),
  day_shift: z.unknown(),
  night_shift: z.unknown(),
  day_one_morning_guard_id: z.uuid(),
  day_one_night_guard_id: z.uuid(),
  day_one_off_guard_id: z.uuid(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});

const ATTENDANCE_FIELDS =
  'id,work_date,check_in_at,check_in_latitude,check_in_longitude,check_in_accuracy_meters,check_in_distance_meters,check_in_boundary_clearance_meters,check_out_at,check_out_latitude,check_out_longitude,check_out_accuracy_meters,check_out_distance_meters,check_out_boundary_clearance_meters,work_start,work_end,checkout_close,target_minutes,worked_minutes,arrival_late_minutes,work_deficit_minutes,status,schedule_type,check_in_open_at,work_start_at,check_in_close_at,checkout_open_at,work_end_at,checkout_close_at';
const SCHEDULE_FIELDS =
  'id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to';
const GEOFENCE_FIELDS =
  'id,latitude,longitude,radius_meters,polygon_vertices,max_accuracy_meters,effective_from,effective_to';

function time(value: string): string {
  return value.slice(0, 5);
}

function toAttendance(value: unknown): PersistedAttendanceRecord {
  const row = AttendanceRowSchema.parse(value);
  const base = {
    id: row.id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    latitude: Number(row.check_in_latitude),
    longitude: Number(row.check_in_longitude),
    accuracyMeters: Number(row.check_in_accuracy_meters),
    distanceMeters: Number(row.check_in_distance_meters),
    boundaryClearanceMeters: row.check_in_boundary_clearance_meters === null
      ? null
      : Number(row.check_in_boundary_clearance_meters),
    workStart: time(row.work_start),
    workEnd: time(row.work_end),
    checkoutClose: time(row.checkout_close),
    targetMinutes: row.target_minutes,
    arrivalLateMinutes: row.arrival_late_minutes,
    scheduleType: row.schedule_type,
    checkInOpenAt: row.check_in_open_at,
    workStartAt: row.work_start_at,
    checkInCloseAt: row.check_in_close_at,
    checkoutOpenAt: row.checkout_open_at,
    workEndAt: row.work_end_at,
    checkoutCloseAt: row.checkout_close_at,
  };
  if (row.status === 'CHECKED_IN') {
    return CheckInRecordSchema.parse({ ...base, status: row.status });
  }
  return CompletedAttendanceRecordSchema.parse({
    ...base,
    checkOutAt: row.check_out_at,
    checkOutLatitude:
      row.check_out_latitude === null ? null : Number(row.check_out_latitude),
    checkOutLongitude:
      row.check_out_longitude === null ? null : Number(row.check_out_longitude),
    checkOutAccuracyMeters:
      row.check_out_accuracy_meters === null
        ? null
        : Number(row.check_out_accuracy_meters),
    checkOutDistanceMeters:
      row.check_out_distance_meters === null
        ? null
        : Number(row.check_out_distance_meters),
    checkOutBoundaryClearanceMeters:
      row.check_out_boundary_clearance_meters === null
        ? null
        : Number(row.check_out_boundary_clearance_meters),
    workedMinutes: row.worked_minutes,
    workDeficitMinutes: row.work_deficit_minutes,
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
  const version = {
    id: row.id,
    maxAccuracyMeters: row.max_accuracy_meters,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
  return GeofenceRuleSchema.parse(row.polygon_vertices === null
    ? {
        ...version,
        shape: 'CIRCLE',
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        radiusMeters: row.radius_meters,
      }
    : { ...version, shape: 'POLYGON', vertices: row.polygon_vertices });
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
  ): Promise<PersistedAttendanceRecord | null> {
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

  async findSecuritySchedules(workDate: string): Promise<SecurityScheduleSettingsResponse> {
    const { data, error } = await this.client
      .from('security_schedule_settings')
      .select('id,day_shift,night_shift,day_one_morning_guard_id,day_one_night_guard_id,day_one_off_guard_id,effective_from,effective_to')
      .lte('effective_from', workDate)
      .or(`effective_to.is.null,effective_to.gte.${workDate}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw lookupError('Jadwal Satpam tidak dapat dimuat');
    if (!data) return SecurityScheduleSettingsResponseSchema.parse({
      effectiveOn: workDate, dayShift: null, nightShift: null, roster: null, preview: [],
    });
    const row = SecurityScheduleRowSchema.parse(data);
    const roster = {
      dayOneMorningGuardId: row.day_one_morning_guard_id,
      dayOneNightGuardId: row.day_one_night_guard_id,
      dayOneOffGuardId: row.day_one_off_guard_id,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    };
    const rule = (value: unknown, scheduleType: 'SECURITY_DAY' | 'SECURITY_NIGHT') =>
      ScheduleRuleSchema.parse({
        id: row.id,
        scheduleType,
        ...(value as object),
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      });
    return SecurityScheduleSettingsResponseSchema.parse({
      effectiveOn: workDate,
      dayShift: rule(row.day_shift, 'SECURITY_DAY'),
      nightShift: rule(row.night_shift, 'SECURITY_NIGHT'),
      roster,
      preview: securityRotationPreview(roster, workDate),
    });
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

  async saveCheckIn(input: SaveCheckInInput): Promise<PersistedAttendanceRecord> {
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
        check_in_boundary_clearance_meters: input.boundaryClearanceMeters,
        work_start: input.schedule.workStart,
        work_end: input.schedule.workEnd,
        checkout_close: input.schedule.checkoutClose,
        target_minutes: input.schedule.targetMinutes,
        arrival_late_minutes: input.arrivalLateMinutes,
        schedule_type: input.schedule.scheduleType,
        check_in_open_at: input.boundaries.checkInOpenAt,
        work_start_at: input.boundaries.workStartAt,
        check_in_close_at: input.boundaries.checkInCloseAt,
        checkout_open_at: input.boundaries.checkoutOpenAt,
        work_end_at: input.boundaries.workEndAt,
        checkout_close_at: input.boundaries.checkoutCloseAt,
        status: 'CHECKED_IN',
      })
      .select(ATTENDANCE_FIELDS)
      .single();
    if (!error && data) return toAttendance(data);
    if (error?.code === '23505') {
      const existing = await this.findAttendance(input.teacherId, input.workDate);
      if (existing) return existing;
    }
    if (error?.code === '23514' && error.message.includes('attendance_leave_conflict')) {
      throw new AppError(
        409,
        'ALREADY_HAS_APPROVED_LEAVE',
        'Check-in tidak dapat dilakukan karena izin sudah disetujui',
      );
    }
    throw new AppError(
      500,
      'ATTENDANCE_SAVE_FAILED',
      'Check-in tidak dapat disimpan',
    );
  }

  async saveCheckout(input: SaveCheckoutInput): Promise<CompletedAttendanceRecord> {
    const { data, error } = await this.client
      .from('attendance_records')
      .update({
        check_out_at: input.checkOutAt,
        check_out_latitude: input.location.latitude,
        check_out_longitude: input.location.longitude,
        check_out_accuracy_meters: input.location.accuracyMeters,
        check_out_distance_meters: input.distanceMeters,
        check_out_boundary_clearance_meters: input.boundaryClearanceMeters,
        worked_minutes: input.workedMinutes,
        work_deficit_minutes: input.workDeficitMinutes,
        status: 'COMPLETED',
      })
      .eq('id', input.attendanceId)
      .eq('teacher_id', input.teacherId)
      .eq('status', 'CHECKED_IN')
      .is('check_out_at', null)
      .select(ATTENDANCE_FIELDS)
      .maybeSingle();
    if (!error && data) {
      return CompletedAttendanceRecordSchema.parse(toAttendance(data));
    }
    if (!error) {
      const existing = await this.findAttendance(
        input.teacherId,
        input.workDate,
      );
      if (existing?.status === 'COMPLETED') return existing;
    }
    throw new AppError(
      500,
      'ATTENDANCE_SAVE_FAILED',
      'Checkout tidak dapat disimpan',
    );
  }

  async listAttendanceHistory(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<{ records: PersistedAttendanceRecord[]; totalItems: number }> {
    const start = (input.page - 1) * input.pageSize;
    const end = start + input.pageSize - 1;
    let query = this.client
      .from('attendance_records')
      .select(ATTENDANCE_FIELDS, { count: 'exact' })
      .eq('teacher_id', teacherId)
      .order('work_date', { ascending: false })
      .order('check_in_at', { ascending: false })
      .range(start, end);
    if (input.month) {
      const [yearText, monthText] = input.month.split('-');
      const year = Number(yearText);
      const month = Number(monthText);
      const nextMonth =
        month === 12
          ? `${year + 1}-01`
          : `${year}-${String(month + 1).padStart(2, '0')}`;
      query = query
        .gte('work_date', `${input.month}-01`)
        .lt('work_date', `${nextMonth}-01`);
    }
    const { data, error, count } = await query;
    if (error) {
      throw new AppError(
        500,
        'ATTENDANCE_HISTORY_FAILED',
        'Riwayat absensi tidak dapat dimuat',
      );
    }
    return {
      records: (data ?? []).map(toAttendance),
      totalItems: count ?? 0,
    };
  }
}
