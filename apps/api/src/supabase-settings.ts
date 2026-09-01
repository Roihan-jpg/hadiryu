import {
  CalendarExceptionSchema,
  CalendarExceptionsResponseSchema,
  GeofenceRuleSchema,
  PayrollRuleSchema,
  ScheduleRuleSchema,
  type CalendarException,
  type CalendarExceptionInput,
  type CalendarExceptionsResponse,
  type CreatePayrollVersionRequest,
  type CreateGeofenceVersionRequest,
  type CreateScheduleVersionRequest,
  type GeofenceRule,
  type GeofenceSettingsResponse,
  type PayrollRule,
  type PayrollSettingsResponse,
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
import { resolvePayrollSettings } from './calendar-payroll.js';
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
const CALENDAR_FIELDS = 'id,work_date,exception_type,name,schedule_type';
const PAYROLL_FIELDS =
  'id,calculation_mode,base_performance_pay,minimum_performance_pay,deduction_rate_per_minute,late_deduction_amount,absent_deduction_amount,rejected_early_departure_rate_per_hour,effective_from,effective_to';

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
const PayrollRuleRowSchema = z.strictObject({
  id: z.uuid(),
  calculation_mode: z.enum(['LEGACY_PER_MINUTE', 'MONTHLY_POLICY']),
  base_performance_pay: NumericDatabaseValueSchema,
  minimum_performance_pay: NumericDatabaseValueSchema,
  deduction_rate_per_minute: NumericDatabaseValueSchema,
  late_deduction_amount: NumericDatabaseValueSchema,
  absent_deduction_amount: NumericDatabaseValueSchema,
  rejected_early_departure_rate_per_hour: NumericDatabaseValueSchema,
  effective_from: z.string(),
  effective_to: z.string().nullable(),
});

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

function toPayrollRule(value: unknown): PayrollRule {
  const row = PayrollRuleRowSchema.parse(value);
  return PayrollRuleSchema.parse({
    id: row.id,
    calculationMode: row.calculation_mode,
    basePerformancePay: Number(row.base_performance_pay),
    minimumPerformancePay: Number(row.minimum_performance_pay),
    deductionRatePerMinute: Number(row.deduction_rate_per_minute),
    lateDeductionAmount: Number(row.late_deduction_amount),
    absentDeductionAmount: Number(row.absent_deduction_amount),
    rejectedEarlyDepartureRatePerHour: Number(
      row.rejected_early_departure_rate_per_hour,
    ),
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

  async getPayroll(effectiveOn: string): Promise<PayrollSettingsResponse> {
    const { data, error } = await this.client
      .from('payroll_rules')
      .select(PAYROLL_FIELDS)
      .lte('effective_from', effectiveOn)
      .or(`effective_to.is.null,effective_to.gte.${effectiveOn}`)
      .order('effective_from', { ascending: false });
    if (error) {
      throw new AppError(500, 'SETTINGS_LOOKUP_FAILED', 'Aturan upah tidak dapat dimuat');
    }
    return resolvePayrollSettings((data ?? []).map(toPayrollRule), effectiveOn);
  }

  async createPayrollVersion(
    actorId: string,
    input: CreatePayrollVersionRequest,
  ): Promise<PayrollSettingsResponse> {
    const { error } = await this.client.rpc('create_payroll_rule_version', {
      p_actor_id: actorId,
      p_effective_from: input.effectiveFrom,
      p_base_performance_pay: input.basePerformancePay,
      p_minimum_performance_pay: input.minimumPerformancePay,
      p_late_deduction_amount: input.lateDeductionAmount,
      p_absent_deduction_amount: input.absentDeductionAmount,
      p_rejected_early_departure_rate_per_hour:
        input.rejectedEarlyDepartureRatePerHour,
    });
    if (error) throw mutationError(error);
    return this.getPayroll(input.effectiveFrom);
  }
}
