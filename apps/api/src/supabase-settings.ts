import {
  GeofenceRuleSchema,
  ScheduleRuleSchema,
  type CreateGeofenceVersionRequest,
  type CreateScheduleVersionRequest,
  type GeofenceRule,
  type GeofenceSettingsResponse,
  type ScheduleRule,
  type ScheduleSettingsResponse,
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

const NumericDatabaseValueSchema = z.union([z.number(), z.string()]);
const GeofenceRowSchema = z.strictObject({
  id: z.uuid(),
  latitude: NumericDatabaseValueSchema,
  longitude: NumericDatabaseValueSchema,
  radius_meters: z.number().int(),
  max_accuracy_meters: z.number().int(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});

const SCHEDULE_FIELDS =
  'id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to';
const GEOFENCE_FIELDS =
  'id,latitude,longitude,radius_meters,max_accuracy_meters,effective_from,effective_to';

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

function toGeofenceRule(value: unknown): GeofenceRule {
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

function mutationError(error: { code?: string; message?: string } | null): AppError {
  const inPast = error?.message?.includes('EFFECTIVE_DATE_IN_PAST');
  const conflict =
    error?.code === 'P0001' ||
    error?.code === '23P01' ||
    error?.message?.includes('EFFECTIVE_DATE_CONFLICT');
  return new AppError(
    inPast ? 422 : conflict ? 409 : 500,
    inPast
      ? 'EFFECTIVE_DATE_IN_PAST'
      : conflict
        ? 'EFFECTIVE_DATE_CONFLICT'
        : 'SETTINGS_UPDATE_FAILED',
    inPast
      ? 'Tanggal mulai tidak boleh berada di masa lalu'
      : conflict
      ? 'Tanggal mulai harus setelah versi terbaru'
      : 'Versi pengaturan tidak dapat dibuat',
  );
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

  async createScheduleVersion(
    actorId: string,
    input: CreateScheduleVersionRequest,
  ): Promise<ScheduleSettingsResponse> {
    const { error } = await this.client.rpc('create_schedule_rule_versions', {
      p_actor_id: actorId,
      p_effective_from: input.effectiveFrom,
      p_weekday: input.weekday,
      p_saturday: input.saturday,
    });
    if (error) throw mutationError(error);
    return this.getSchedules(input.effectiveFrom);
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

  async createGeofenceVersion(
    actorId: string,
    input: CreateGeofenceVersionRequest,
  ): Promise<GeofenceSettingsResponse> {
    const { error } = await this.client.rpc('create_geofence_rule_version', {
      p_actor_id: actorId,
      p_effective_from: input.effectiveFrom,
      p_geofence: {
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        maxAccuracyMeters: input.maxAccuracyMeters,
      },
    });
    if (error) throw mutationError(error);
    return this.getGeofence(input.effectiveFrom);
  }
}
