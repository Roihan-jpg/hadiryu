import {
  CreateTeacherRequestSchema,
  ListTeachersQuerySchema,
  PasswordResetResponseSchema,
  ResetTeacherPasswordRequestSchema,
  UpdateTeacherRequestSchema,
  type AuthUser,
  type CreateTeacherRequest,
  type ListTeachersQuery,
  type PasswordResetResult,
  type Teacher,
  type TeacherListResponse,
  type TeacherResponse,
  type UpdateTeacherRequest,
} from '@absensi/contracts';
import type { Express, Request } from 'express';
import { z } from 'zod';

import {
  AppError,
  ACCESS_COOKIE_NAME,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';

const TeacherIdSchema = z.uuid();

export interface TeacherService {
  list(input: ListTeachersQuery): Promise<TeacherListResponse>;
  create(actorId: string, input: CreateTeacherRequest): Promise<Teacher>;
  update(
    actorId: string,
    teacherId: string,
    input: UpdateTeacherRequest,
  ): Promise<Teacher>;
  setActive(
    actorId: string,
    teacherId: string,
    isActive: boolean,
    accessToken?: string,
  ): Promise<Teacher>;
  resetPassword(
    actorId: string,
    teacherId: string,
  ): Promise<PasswordResetResult>;
}

function actorId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

function parseTeacherId(value: unknown): string {
  const parsed = TeacherIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ID Guru tidak valid');
  }
  return parsed.data;
}

function validationError(message: string, details: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function registerTeacherRoutes(
  app: Express,
  authService: AuthService,
  teacherService: TeacherService,
): void {
  const adminGuards = [createSessionGuard(authService), requireRole('SUPER_ADMIN')];

  app.get('/api/admin/teachers', ...adminGuards, async (request, response, next) => {
    try {
      const parsed = ListTeachersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError('Parameter daftar Guru tidak valid', parsed.error.flatten());
      }
      response.status(200).json(await teacherService.list(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/teachers', ...adminGuards, async (request, response, next) => {
    try {
      const parsed = CreateTeacherRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError('Data Guru tidak valid', parsed.error.flatten());
      }
      const teacher = await teacherService.create(actorId(request), parsed.data);
      response.status(201).json({ teacher } satisfies TeacherResponse);
    } catch (error) {
      next(error);
    }
  });

  app.patch(
    '/api/admin/teachers/:id',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = UpdateTeacherRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw validationError('Perubahan Guru tidak valid', parsed.error.flatten());
        }
        const teacher = await teacherService.update(
          actorId(request),
          parseTeacherId(request.params['id'] ?? ''),
          parsed.data,
        );
        response.status(200).json({ teacher } satisfies TeacherResponse);
      } catch (error) {
        next(error);
      }
    },
  );

  for (const [action, isActive] of [
    ['activate', true],
    ['deactivate', false],
  ] as const) {
    app.post(
      `/api/admin/teachers/:id/${action}`,
      ...adminGuards,
      async (request, response, next) => {
        try {
          const teacher = await teacherService.setActive(
            actorId(request),
            parseTeacherId(request.params['id'] ?? ''),
            isActive,
            (request.cookies as Record<string,string>)[ACCESS_COOKIE_NAME],
          );
          response.status(200).json({ teacher } satisfies TeacherResponse);
        } catch (error) {
          next(error);
        }
      },
    );
  }

  app.post(
    '/api/admin/teachers/:id/reset-password',
    ...adminGuards,
    async (request, response, next) => {
      try {
        const parsed = ResetTeacherPasswordRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw validationError('Password sementara tidak valid', parsed.error.flatten());
        }
        const result = await teacherService.resetPassword(
          actorId(request),
          parseTeacherId(request.params['id'] ?? ''),
        );
        response.status(200).json(PasswordResetResponseSchema.parse(result));
      } catch (error) {
        next(error);
      }
    },
  );
}
