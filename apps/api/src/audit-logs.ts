import {
  AuditLogListResponseSchema,
  ListAuditLogsQuerySchema,
  type AuditLog,
  type AuditLogListResponse,
  type ListAuditLogsQuery,
} from '@absensi/contracts';
import type { Express } from 'express';

import { AppError, createSessionGuard, requireRole, type AuthService } from './auth.js';

export interface AuditLogRepository {
  list(input: ListAuditLogsQuery): Promise<{ records: AuditLog[]; totalItems: number }>;
}

export interface AuditLogService {
  list(input: ListAuditLogsQuery): Promise<AuditLogListResponse>;
}

export function createAuditLogService(repository: AuditLogRepository): AuditLogService {
  return {
    async list(rawInput) {
      const input = ListAuditLogsQuerySchema.parse(rawInput);
      const result = await repository.list(input);
      return AuditLogListResponseSchema.parse({
        data: result.records,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          totalItems: result.totalItems,
          totalPages: Math.ceil(result.totalItems / input.pageSize),
        },
      });
    },
  };
}

export function registerAuditLogRoutes(
  app: Express,
  authService: AuthService,
  service: AuditLogService,
): void {
  app.get(
    '/api/admin/audit-logs',
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
    async (request, response, next) => {
      try {
        const parsed = ListAuditLogsQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Filter audit tidak valid', parsed.error.flatten());
        }
        response.status(200).json(await service.list(parsed.data));
      } catch (error) { next(error); }
    },
  );
}
