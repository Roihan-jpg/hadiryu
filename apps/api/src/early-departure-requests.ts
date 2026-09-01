import {
  AdminEarlyDepartureRequestListResponseSchema,
  CreateEarlyDepartureRequestSchema,
  DecideEarlyDepartureRequestSchema,
  EarlyDepartureRequestListResponseSchema,
  EarlyDepartureRequestSchema,
  ListAdminEarlyDepartureRequestsQuerySchema,
  ListEarlyDepartureRequestsQuerySchema,
  type AdminEarlyDepartureRequest,
  type AdminEarlyDepartureRequestListResponse,
  type AuthUser,
  type CreateEarlyDepartureRequest,
  type DecideEarlyDepartureRequest,
  type EarlyDepartureRequest,
  type EarlyDepartureRequestListResponse,
  type GeofenceRule,
  type ListAdminEarlyDepartureRequestsQuery,
  type ListEarlyDepartureRequestsQuery,
} from '@absensi/contracts';
import type { Express, Request } from 'express';
import { z } from 'zod';

import {
  jakartaDateTime,
  timeMinutes,
  validatedDistance,
  type PersistedAttendanceRecord,
} from './attendance.js';
import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';

const RequestIdSchema = z.uuid();

export interface SaveEarlyDepartureRequestInput
  extends CreateEarlyDepartureRequest {
  distanceMeters: number;
}

export interface EarlyDepartureRequestRepository {
  findAttendance(
    teacherId: string,
    workDate: string,
  ): Promise<PersistedAttendanceRecord | null>;
  findGeofence(workDate: string): Promise<GeofenceRule | null>;
  create(
    teacherId: string,
    input: SaveEarlyDepartureRequestInput,
  ): Promise<EarlyDepartureRequest>;
  findOwn(
    teacherId: string,
    requestId: string,
  ): Promise<EarlyDepartureRequest | null>;
  listOwn(
    teacherId: string,
    input: ListEarlyDepartureRequestsQuery,
  ): Promise<{ records: EarlyDepartureRequest[]; totalItems: number }>;
  findAny(requestId: string): Promise<AdminEarlyDepartureRequest | null>;
  listAdmin(
    input: ListAdminEarlyDepartureRequestsQuery,
  ): Promise<{ records: AdminEarlyDepartureRequest[]; totalItems: number }>;
  decide(
    requestId: string,
    actorId: string,
    status: 'APPROVED' | 'REJECTED',
    decisionNote: string | null,
    decidedAt: string,
  ): Promise<EarlyDepartureRequest>;
}

export interface EarlyDepartureRequestService {
  create(
    teacherId: string,
    input: CreateEarlyDepartureRequest,
  ): Promise<EarlyDepartureRequest>;
  listOwn(
    teacherId: string,
    input: ListEarlyDepartureRequestsQuery,
  ): Promise<EarlyDepartureRequestListResponse>;
  listAdmin(
    input: ListAdminEarlyDepartureRequestsQuery,
  ): Promise<AdminEarlyDepartureRequestListResponse>;
  approve(
    actorId: string,
    requestId: string,
    input: DecideEarlyDepartureRequest,
  ): Promise<EarlyDepartureRequest>;
  reject(
    actorId: string,
    requestId: string,
    input: DecideEarlyDepartureRequest,
  ): Promise<EarlyDepartureRequest>;
}

function pagination(totalItems: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  };
}

function requestId(value: unknown): string {
  const parsed = RequestIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'ID permohonan pulang awal tidak valid',
    );
  }
  return parsed.data;
}

export function createEarlyDepartureRequestService(
  repository: EarlyDepartureRequestRepository,
  now: () => Date = () => new Date(),
): EarlyDepartureRequestService {
  async function decide(
    actorId: string,
    id: string,
    input: DecideEarlyDepartureRequest,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<EarlyDepartureRequest> {
    const existing = await repository.findAny(id);
    if (!existing) {
      throw new AppError(
        404,
        'EARLY_DEPARTURE_NOT_FOUND',
        'Permohonan pulang awal tidak ditemukan',
      );
    }
    if (existing.status !== 'PENDING') {
      throw new AppError(
        409,
        'EARLY_DEPARTURE_NOT_PENDING',
        'Hanya permohonan Pending yang dapat diputuskan',
      );
    }
    return EarlyDepartureRequestSchema.parse(
      await repository.decide(
        id,
        actorId,
        status,
        input.decisionNote ?? null,
        now().toISOString(),
      ),
    );
  }

  return {
    async create(teacherId, rawInput) {
      const input = CreateEarlyDepartureRequestSchema.parse(rawInput);
      const serverNow = now();
      const current = jakartaDateTime(serverNow);
      const attendance = await repository.findAttendance(
        teacherId,
        current.workDate,
      );
      if (!attendance) {
        throw new AppError(
          409,
          'CHECK_IN_REQUIRED',
          'Pulang awal hanya dapat diajukan setelah check-in',
        );
      }
      if (attendance.status !== 'CHECKED_IN') {
        throw new AppError(
          409,
          'ATTENDANCE_ALREADY_COMPLETED',
          'Absensi hari ini sudah selesai',
        );
      }
      if (current.minuteOfDay >= timeMinutes(attendance.workEnd)) {
        throw new AppError(
          422,
          'NOT_EARLY_DEPARTURE',
          'Permohonan hanya dapat dibuat sebelum jam kerja selesai',
        );
      }
      const geofence = await repository.findGeofence(current.workDate);
      if (!geofence) {
        throw new AppError(
          422,
          'GEOFENCE_NOT_CONFIGURED',
          'Lokasi sekolah untuk hari ini belum dikonfigurasi',
        );
      }
      const distanceMeters = validatedDistance(input, geofence);
      return EarlyDepartureRequestSchema.parse(
        await repository.create(teacherId, { ...input, distanceMeters }),
      );
    },

    async listOwn(teacherId, rawInput) {
      const input = ListEarlyDepartureRequestsQuerySchema.parse(rawInput);
      const result = await repository.listOwn(teacherId, input);
      return EarlyDepartureRequestListResponseSchema.parse({
        data: result.records,
        pagination: pagination(result.totalItems, input.page, input.pageSize),
      });
    },

    async listAdmin(rawInput) {
      const input = ListAdminEarlyDepartureRequestsQuerySchema.parse(rawInput);
      const result = await repository.listAdmin(input);
      return AdminEarlyDepartureRequestListResponseSchema.parse({
        data: result.records,
        pagination: pagination(result.totalItems, input.page, input.pageSize),
      });
    },

    approve(actorId, id, input) {
      return decide(
        actorId,
        id,
        DecideEarlyDepartureRequestSchema.parse(input),
        'APPROVED',
      );
    },

    reject(actorId, id, input) {
      return decide(
        actorId,
        id,
        DecideEarlyDepartureRequestSchema.parse(input),
        'REJECTED',
      );
    },
  };
}

function userId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

function validationError(message: string, details: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function registerEarlyDepartureRequestRoutes(
  app: Express,
  authService: AuthService,
  service: EarlyDepartureRequestService,
): void {
  const teacherGuards = [createSessionGuard(authService), requireRole('USER')];
  const adminGuards = [
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
  ];

  app.get('/api/early-departure-requests', ...teacherGuards, async (request, response, next) => {
    try {
      const parsed = ListEarlyDepartureRequestsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw validationError('Filter pulang awal tidak valid', parsed.error.flatten());
      response.status(200).json(await service.listOwn(userId(request), parsed.data));
    } catch (error) { next(error); }
  });

  app.post('/api/early-departure-requests', ...teacherGuards, async (request, response, next) => {
    try {
      const parsed = CreateEarlyDepartureRequestSchema.safeParse(request.body);
      if (!parsed.success) throw validationError('Permohonan pulang awal tidak valid', parsed.error.flatten());
      response.status(201).json({
        earlyDepartureRequest: await service.create(userId(request), parsed.data),
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/early-departure-requests', ...adminGuards, async (request, response, next) => {
    try {
      const parsed = ListAdminEarlyDepartureRequestsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw validationError('Filter approval pulang awal tidak valid', parsed.error.flatten());
      response.status(200).json(await service.listAdmin(parsed.data));
    } catch (error) { next(error); }
  });

  for (const [action, status] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
    app.post(`/api/admin/early-departure-requests/:id/${action}`, ...adminGuards, async (request, response, next) => {
      try {
        const parsed = DecideEarlyDepartureRequestSchema.safeParse(request.body);
        if (!parsed.success) throw validationError('Keputusan pulang awal tidak valid', parsed.error.flatten());
        const id = requestId(request.params['id']);
        const result = status === 'APPROVED'
          ? await service.approve(userId(request), id, parsed.data)
          : await service.reject(userId(request), id, parsed.data);
        response.status(200).json({ earlyDepartureRequest: result });
      } catch (error) { next(error); }
    });
  }
}
