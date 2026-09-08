import {
  CalendarExceptionSchema,
  CalendarExceptionsResponseSchema,
  GeofenceRuleSchema,
  ScheduleRuleSchema,
  type CalendarException,
  type CalendarExceptionInput,
  type CalendarExceptionsResponse,
  type GeofenceRule,
  type GeofenceSettingsResponse,
  type SaveGeofenceSettingsRequest,
  type SaveScheduleSettingsRequest,
  type ScheduleRule,
  type ScheduleSettingsResponse,
  type SaveSecurityScheduleSettingsRequest,
  type SecurityScheduleSettingsResponse,
  SecurityScheduleSettingsResponseSchema,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import {
  resolveGeofenceSettings,
  resolveScheduleSettings,
  type SettingsService,
} from './schedule-geofence.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';
import { securityRotationPreview } from './security-duty.js';

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
const ScheduleRpcRowSchema = ScheduleRowSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});
const ScheduleResultRowSchema = z.union([ScheduleRowSchema, ScheduleRpcRowSchema]);

const NumericDatabaseValueSchema = z.union([z.number(), z.string()]);
const GeofenceRowSchema = z.strictObject({
  id: z.uuid(),
  latitude: NumericDatabaseValueSchema,
  longitude: NumericDatabaseValueSchema,
  radius_meters: z.number().int(),
  polygon_vertices: z.unknown().nullable(),
  max_accuracy_meters: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});
const GeofenceRpcRowSchema = GeofenceRowSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});
const GeofenceResultRowSchema = z.union([GeofenceRowSchema, GeofenceRpcRowSchema]);

const SCHEDULE_FIELDS =
  'id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to';
const GEOFENCE_FIELDS =
  'id,latitude,longitude,radius_meters,polygon_vertices,max_accuracy_meters,effective_from,effective_to';
const CALENDAR_FIELDS = 'id,work_date,exception_type,name,schedule_type';
const SecurityScheduleRowSchema = z.strictObject({
  id: z.uuid(), day_shift: z.unknown(), night_shift: z.unknown(),
  day_one_morning_guard_id: z.uuid(), day_one_night_guard_id: z.uuid(), day_one_off_guard_id: z.uuid(),
  effective_from: z.string(), effective_to: z.string().nullable(),
});
const SecurityScheduleRpcRowSchema = SecurityScheduleRowSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});
const SecurityScheduleResultRowSchema = z.union([
  SecurityScheduleRowSchema,
  SecurityScheduleRpcRowSchema,
]);

const CalendarExceptionRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  name: z.string(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
});
const CalendarExceptionRpcRowSchema = CalendarExceptionRowSchema.extend({
  created_at: z.string(),
  updated_at: z.string(),
});
const CalendarExceptionResultRowSchema = z.union([
  CalendarExceptionRowSchema,
  CalendarExceptionRpcRowSchema,
]);

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function time(value: string): string {
  return value.slice(0, 5);
}

function toScheduleRule(value: unknown): ScheduleRule {
  const row = ScheduleResultRowSchema.parse(value);
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

function toGeofenceRule(value: unknown): GeofenceRule {
  const row = GeofenceResultRowSchema.parse(value);
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

function polygonStorageValues(input: SaveGeofenceSettingsRequest) {
  const latitude = input.vertices.reduce((sum, vertex) => sum + vertex.latitude, 0) /
    input.vertices.length;
  const longitude = input.vertices.reduce((sum, vertex) => sum + vertex.longitude, 0) /
    input.vertices.length;
  const metersPerLatitudeDegree = 111_195.08;
  const metersPerLongitudeDegree = metersPerLatitudeDegree *
    Math.cos(latitude * Math.PI / 180);
  const radiusMeters = Math.max(25, Math.ceil(Math.max(...input.vertices.map((vertex) =>
    Math.hypot(
      (vertex.latitude - latitude) * metersPerLatitudeDegree,
      (vertex.longitude - longitude) * metersPerLongitudeDegree,
    ),
  ))));
  return { latitude, longitude, radiusMeters };
}

function toCalendarException(value: unknown): CalendarException {
  const row = CalendarExceptionResultRowSchema.parse(value);
  return CalendarExceptionSchema.parse({
    id: row.id,
    workDate: row.work_date,
    exceptionType: row.exception_type,
    name: row.name,
    scheduleType: row.schedule_type,
  });
}

function mutationError(error: { code?: string; message?: string } | null): AppError {
  const invalid = error?.code === 'P0001' || error?.code?.startsWith('23');
  return new AppError(
    invalid ? 422 : 500,
    invalid ? 'SETTINGS_VALIDATION_FAILED' : 'SETTINGS_UPDATE_FAILED',
    invalid ? 'Nilai pengaturan tidak valid' : 'Pengaturan tidak dapat disimpan',
  );
}

function calendarMutationError(error: { code?: string; message?: string } | null): AppError {
  const missing = error?.message?.includes('CALENDAR_EXCEPTION_NOT_FOUND');
  const inPast = error?.message?.includes('CALENDAR_DATE_IN_PAST');
  const conflict =
    error?.code === '23505' || error?.message?.includes('CALENDAR_DATE_CONFLICT');
  return new AppError(
    missing ? 404 : inPast ? 422 : conflict ? 409 : 500,
    missing
      ? 'CALENDAR_EXCEPTION_NOT_FOUND'
      : inPast
        ? 'CALENDAR_DATE_IN_PAST'
        : conflict
          ? 'CALENDAR_DATE_CONFLICT'
          : 'CALENDAR_UPDATE_FAILED',
    missing
      ? 'Aturan kalender tidak ditemukan'
      : inPast
        ? 'Tanggal kalender yang telah berlalu tidak dapat diubah'
        : conflict
          ? 'Tanggal tersebut sudah memiliki aturan kalender'
          : 'Aturan kalender tidak dapat disimpan',
  );
}

export function toSecurityScheduleSettings(
  value: unknown,
  effectiveOn: string,
): SecurityScheduleSettingsResponse {
  if (!value) {
    return SecurityScheduleSettingsResponseSchema.parse({
      effectiveOn,
      dayShift: null,
      nightShift: null,
      roster: null,
      preview: [],
    });
  }
  const row = SecurityScheduleResultRowSchema.parse(value);
  const makeRule = (input: unknown, scheduleType: 'SECURITY_DAY' | 'SECURITY_NIGHT') =>
    ScheduleRuleSchema.parse({
      id: row.id,
      scheduleType,
      ...(input as object),
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    });
  const roster = {
    dayOneMorningGuardId: row.day_one_morning_guard_id,
    dayOneNightGuardId: row.day_one_night_guard_id,
    dayOneOffGuardId: row.day_one_off_guard_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
  return SecurityScheduleSettingsResponseSchema.parse({
    effectiveOn,
    dayShift: makeRule(row.day_shift, 'SECURITY_DAY'),
    nightShift: makeRule(row.night_shift, 'SECURITY_NIGHT'),
    roster,
    preview: securityRotationPreview(roster, effectiveOn),
  });
}

export class SupabaseSettingsService implements SettingsService {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
  }

  async getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse> {
    const { data, error } = await this.client
      .from('schedule_rules')
      .select(SCHEDULE_FIELDS)
      .lte('effective_from', effectiveOn)
      .or(`effective_to.is.null,effective_to.gte.${effectiveOn}`)
      .order('effective_from', { ascending: false });
    if (error) {
      throw new AppError(500, 'SETTINGS_LOOKUP_FAILED', 'Aturan jadwal tidak dapat dimuat');
    }
    return resolveScheduleSettings((data ?? []).map(toScheduleRule), effectiveOn);
  }

  async saveSchedules(
    actorId: string,
    input: SaveScheduleSettingsRequest,
  ): Promise<ScheduleSettingsResponse> {
    const { data, error } = await this.client.rpc('save_schedule_settings', {
      p_actor_id: actorId,
      p_weekday: input.weekday,
      p_saturday: input.saturday,
    });
    if (error) throw mutationError(error);
    const rules = (data ?? []).map(toScheduleRule);
    const effectiveOn = rules[0]?.effectiveFrom;
    if (!effectiveOn) {
      throw new AppError(500, 'SETTINGS_UPDATE_FAILED', 'Pengaturan jadwal tidak dapat disimpan');
    }
    return resolveScheduleSettings(rules, effectiveOn);
  }

  async getSecuritySchedules(effectiveOn: string): Promise<SecurityScheduleSettingsResponse> {
    const { data, error } = await this.client.from('security_schedule_settings')
      .select('id,day_shift,night_shift,day_one_morning_guard_id,day_one_night_guard_id,day_one_off_guard_id,effective_from,effective_to')
      .lte('effective_from', effectiveOn).or(`effective_to.is.null,effective_to.gte.${effectiveOn}`)
      .order('effective_from', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new AppError(500, 'SETTINGS_LOOKUP_FAILED', 'Aturan jadwal Satpam tidak dapat dimuat');
    return toSecurityScheduleSettings(data, effectiveOn);
  }

  async saveSecuritySchedules(actorId: string, input: SaveSecurityScheduleSettingsRequest): Promise<SecurityScheduleSettingsResponse> {
    const { data, error } = await this.client.rpc('save_security_schedule_settings', {
      p_actor_id: actorId, p_day_shift: input.dayShift, p_night_shift: input.nightShift,
      p_day_one_morning_guard_id: input.dayOneMorningGuardId,
      p_day_one_night_guard_id: input.dayOneNightGuardId,
      p_day_one_off_guard_id: input.dayOneOffGuardId,
    });
    if (error) throw mutationError(error);
    const row = SecurityScheduleResultRowSchema.parse(data);
    return toSecurityScheduleSettings(row, row.effective_from);
  }

  async getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse> {
    const { data, error } = await this.client
      .from('geofence_rules')
      .select(GEOFENCE_FIELDS)
      .lte('effective_from', effectiveOn)
      .or(`effective_to.is.null,effective_to.gte.${effectiveOn}`)
      .order('effective_from', { ascending: false });
    if (error) {
      throw new AppError(500, 'SETTINGS_LOOKUP_FAILED', 'Aturan geofence tidak dapat dimuat');
    }
    return resolveGeofenceSettings((data ?? []).map(toGeofenceRule), effectiveOn);
  }

  async saveGeofence(
    actorId: string,
    input: SaveGeofenceSettingsRequest,
  ): Promise<GeofenceSettingsResponse> {
    const storage = polygonStorageValues(input);
    const { data, error } = await this.client.rpc('save_geofence_settings', {
      p_actor_id: actorId,
      p_geofence: {
        shape: input.shape,
        vertices: input.vertices,
        ...storage,
        maxAccuracyMeters: input.maxAccuracyMeters,
      },
    });
    if (error) throw mutationError(error);
    const geofence = toGeofenceRule(data);
    return resolveGeofenceSettings([geofence], geofence.effectiveFrom);
  }

  async listCalendarExceptions(): Promise<CalendarExceptionsResponse> {
    const { data, error } = await this.client
      .from('calendar_exceptions')
      .select(CALENDAR_FIELDS)
      .order('work_date');
    if (error) {
      throw new AppError(500, 'SETTINGS_LOOKUP_FAILED', 'Aturan kalender tidak dapat dimuat');
    }
    return CalendarExceptionsResponseSchema.parse({
      exceptions: (data ?? []).map(toCalendarException),
    });
  }

  async createCalendarException(
    actorId: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    const { data, error } = await this.client.rpc('create_calendar_exception', {
      p_actor_id: actorId,
      p_work_date: input.workDate,
      p_exception_type: input.exceptionType,
      p_name: input.name,
      p_schedule_type: input.scheduleType,
    });
    if (error) throw calendarMutationError(error);
    return toCalendarException(data);
  }

  async updateCalendarException(
    actorId: string,
    id: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    const { data, error } = await this.client.rpc('update_calendar_exception', {
      p_actor_id: actorId,
      p_id: id,
      p_work_date: input.workDate,
      p_exception_type: input.exceptionType,
      p_name: input.name,
      p_schedule_type: input.scheduleType,
    });
    if (error) throw calendarMutationError(error);
    return toCalendarException(data);
  }

  async deleteCalendarException(actorId: string, id: string): Promise<void> {
    const { error } = await this.client.rpc('delete_calendar_exception', {
      p_actor_id: actorId,
      p_id: id,
    });
    if (error) throw calendarMutationError(error);
  }

}
