import {
  CreateGeofenceVersionRequestSchema,
  CreateScheduleVersionRequestSchema,
  GeofenceSettingsResponseSchema,
  GeofenceSettingsQuerySchema,
  ScheduleSettingsResponseSchema,
  ScheduleSettingsQuerySchema,
  type AuthUser,
  type CreateGeofenceVersionRequest,
  type CreateScheduleVersionRequest,
  type GeofenceRule,
  type GeofenceSettingsResponse,
  type ScheduleRule,
  type ScheduleSettingsResponse,
} from '@absensi/contracts';
import type { Express, Request } from 'express';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';

interface EffectiveVersion {
  effectiveFrom: string;
  effectiveTo: string | null;
}

function resolveEffectiveVersion<T extends EffectiveVersion>(
  versions: readonly T[],
  effectiveOn: string,
): T | null {
  return (
    versions
      .filter(
        (version) =>
          version.effectiveFrom <= effectiveOn &&
          (version.effectiveTo === null || effectiveOn <= version.effectiveTo),
      )
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ??
    null
  );
}

export function resolveScheduleSettings(
  versions: readonly ScheduleRule[],
  effectiveOn: string,
): ScheduleSettingsResponse {
  return ScheduleSettingsResponseSchema.parse({
    effectiveOn,
    weekday: resolveEffectiveVersion(
      versions.filter((version) => version.scheduleType === 'WEEKDAY'),
      effectiveOn,
    ),
    saturday: resolveEffectiveVersion(
      versions.filter((version) => version.scheduleType === 'SATURDAY'),
      effectiveOn,
    ),
  });
}

export function resolveGeofenceSettings(
  versions: readonly GeofenceRule[],
  effectiveOn: string,
): GeofenceSettingsResponse {
  return GeofenceSettingsResponseSchema.parse({
    effectiveOn,
    geofence: resolveEffectiveVersion(versions, effectiveOn),
  });
}

export interface SettingsService {
  getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse>;
  createScheduleVersion(
    actorId: string,
    input: CreateScheduleVersionRequest,
  ): Promise<ScheduleSettingsResponse>;
  getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse>;
  createGeofenceVersion(
    actorId: string,
    input: CreateGeofenceVersionRequest,
  ): Promise<GeofenceSettingsResponse>;
}

function actorId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

function validationError(message: string, details: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function registerSettingsRoutes(
  app: Express,
  authService: AuthService,
  settingsService: SettingsService,
): void {
  const adminGuards = [createSessionGuard(authService), requireRole('SUPER_ADMIN')];

  app.get(
    '/api/admin/settings/schedules',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = ScheduleSettingsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw validationError(
            'Tanggal aturan jadwal tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(
          await settingsService.getSchedules(parsed.data.effectiveOn),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/settings/schedules',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = CreateScheduleVersionRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw validationError('Aturan jadwal tidak valid', parsed.error.flatten());
        }
        response.status(201).json(
          await settingsService.createScheduleVersion(
            actorId(request),
            parsed.data,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/admin/settings/geofence',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = GeofenceSettingsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw validationError(
            'Tanggal aturan geofence tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(
          await settingsService.getGeofence(parsed.data.effectiveOn),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/settings/geofence',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = CreateGeofenceVersionRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw validationError('Aturan geofence tidak valid', parsed.error.flatten());
        }
        response.status(201).json(
          await settingsService.createGeofenceVersion(
            actorId(request),
            parsed.data,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
}
