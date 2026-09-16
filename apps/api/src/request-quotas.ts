import {
  RequestQuotaQuerySchema,
  RequestQuotaResponseSchema,
  type AuthUser,
  type RequestQuotaQuery,
  type RequestQuotaResponse,
} from '@absensi/contracts';
import type { Express, Request } from 'express';
import { z } from 'zod';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';

const MONTHLY_LIMIT = 2 as const;
const RequestQuotaLeaveRowSchema = z.strictObject({
  leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL', 'MATERNITY_LEAVE']),
});

export function countLateArrivalQuotaRows(rows: unknown[]): number {
  return rows
    .map((row) => RequestQuotaLeaveRowSchema.parse(row))
    .filter((row) => row.leave_type === 'LATE_ARRIVAL')
    .length;
}

export interface RequestQuotaRepository {
  countActive(
    teacherId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ lateArrival: number; earlyDeparture: number }>;
}

export interface RequestQuotaService {
  get(teacherId: string, input: RequestQuotaQuery): Promise<RequestQuotaResponse>;
}

function nextMonth(month: string): string {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonthNumber = monthNumber === 12 ? 1 : monthNumber + 1;
  return `${nextYear}-${String(nextMonthNumber).padStart(2, '0')}-01`;
}

function quota(used: number) {
  const boundedUsed = Math.min(MONTHLY_LIMIT, used);
  return {
    limit: MONTHLY_LIMIT,
    used: boundedUsed,
    remaining: MONTHLY_LIMIT - boundedUsed,
  };
}

export function createRequestQuotaService(
  repository: RequestQuotaRepository,
): RequestQuotaService {
  return {
    async get(teacherId, rawInput) {
      const input = RequestQuotaQuerySchema.parse(rawInput);
      const usage = await repository.countActive(
        teacherId,
        `${input.month}-01`,
        nextMonth(input.month),
      );
      return RequestQuotaResponseSchema.parse({
        month: input.month,
        lateArrival: quota(usage.lateArrival),
        earlyDeparture: quota(usage.earlyDeparture),
      });
    },
  };
}

function currentUserId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

export function registerRequestQuotaRoutes(
  app: Express,
  authService: AuthService,
  service: RequestQuotaService,
): void {
  app.get(
    '/api/request-quotas',
    createSessionGuard(authService),
    requireRole('USER', 'SECURITY_GUARD'),
    async (request, response, next) => {
      try {
        const parsed = RequestQuotaQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Bulan kuota tidak valid',
            parsed.error.flatten(),
          );
        }
        response.status(200).json(await service.get(currentUserId(request), parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );
}
