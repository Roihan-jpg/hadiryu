import {
  TeacherListResponseSchema,
  TeacherSchema,
  type CreateTeacherRequest,
  type ListTeachersQuery,
  type ResetTeacherPasswordRequest,
  type Teacher,
  type TeacherListResponse,
  type UpdateTeacherRequest,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import {
  internalEmailForNip,
  type SupabaseAuthConfig,
} from './supabase-auth.js';
import type { TeacherService } from './teachers.js';

const TeacherProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: z.string(),
  full_name: z.string(),
  role: z.literal('USER'),
  is_active: z.boolean(),
  must_change_password: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const PROFILE_FIELDS =
  'id,nip,full_name,role,is_active,must_change_password,created_at,updated_at';

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function toTeacher(value: unknown): Teacher {
  const row = TeacherProfileRowSchema.parse(value);
  return TeacherSchema.parse({
    id: row.id,
    nip: row.nip,
    fullName: row.full_name,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function auditSnapshot(teacher: Teacher) {
  return {
    nip: teacher.nip,
    fullName: teacher.fullName,
    role: 'USER' as const,
    isActive: teacher.isActive,
    mustChangePassword: teacher.mustChangePassword,
  };
}

function isAuthIdentityConflict(code: string | undefined): boolean {
  return code === 'email_exists' || code === 'user_already_exists';
}

export class SupabaseTeacherService implements TeacherService {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
  }

  private async loadTeacher(teacherId: string): Promise<Teacher> {
    const { data, error } = await this.client
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', teacherId)
      .eq('role', 'USER')
      .maybeSingle();
    if (error) {
      throw new AppError(500, 'TEACHER_LOOKUP_FAILED', 'Data Guru tidak dapat dimuat');
    }
    if (!data) {
      throw new AppError(404, 'TEACHER_NOT_FOUND', 'Guru tidak ditemukan');
    }
    return toTeacher(data);
  }

  private async writeAudit(
    actorId: string,
    action: string,
    teacherId: string,
    beforeData: ReturnType<typeof auditSnapshot> | null,
    afterData: ReturnType<typeof auditSnapshot> | null,
  ): Promise<void> {
    const { error } = await this.client.from('audit_logs').insert({
      actor_id: actorId,
      action,
      entity_type: 'profiles',
      entity_id: teacherId,
      before_data: beforeData,
      after_data: afterData,
    });
    if (error) {
      throw new AppError(500, 'AUDIT_WRITE_FAILED', 'Audit Guru tidak dapat dicatat');
    }
  }

  async list(input: ListTeachersQuery): Promise<TeacherListResponse> {
    const start = (input.page - 1) * input.pageSize;
    const end = start + input.pageSize - 1;
    let query = this.client
      .from('profiles')
      .select(PROFILE_FIELDS, { count: 'exact' })
      .eq('role', 'USER')
      .order('full_name', { ascending: true })
      .order('nip', { ascending: true })
      .range(start, end);
    if (input.search) {
      query = query.or(
        `nip.ilike.%${input.search}%,full_name.ilike.%${input.search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) {
      throw new AppError(500, 'TEACHER_LIST_FAILED', 'Daftar Guru tidak dapat dimuat');
    }
    const totalItems = count ?? 0;
    return TeacherListResponseSchema.parse({
      data: (data ?? []).map(toTeacher),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / input.pageSize),
      },
    });
  }

  async create(actorId: string, input: CreateTeacherRequest): Promise<Teacher> {
    const nip = input.nip.toLowerCase();
    const { data: existing, error: lookupError } = await this.client
      .from('profiles')
      .select('id')
      .eq('nip', nip)
      .maybeSingle();
    if (lookupError) {
      throw new AppError(500, 'TEACHER_LOOKUP_FAILED', 'NIP tidak dapat diperiksa');
    }
    if (existing) {
      throw new AppError(409, 'NIP_ALREADY_EXISTS', 'NIP sudah digunakan');
    }

    const { data: authData, error: authError } =
      await this.client.auth.admin.createUser({
        email: internalEmailForNip(nip),
        password: input.initialPassword,
        email_confirm: true,
        app_metadata: { role: 'USER' },
      });
    if (authError || !authData.user) {
      const identityConflict = authError
        ? isAuthIdentityConflict(authError.code)
        : false;
      throw new AppError(
        identityConflict ? 409 : 422,
        identityConflict ? 'NIP_ALREADY_EXISTS' : 'TEACHER_CREATE_FAILED',
        identityConflict ? 'NIP sudah digunakan' : 'Akun Guru tidak dapat dibuat',
      );
    }

    const teacherId = authData.user.id;
    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .insert({
        id: teacherId,
        nip,
        full_name: input.fullName,
        role: 'USER',
        is_active: true,
        must_change_password: true,
      })
      .select(PROFILE_FIELDS)
      .single();
    if (profileError || !profile) {
      const { error: rollbackError } =
        await this.client.auth.admin.deleteUser(teacherId);
      if (rollbackError) {
        throw new AppError(
          500,
          'TEACHER_CONSISTENCY_FAILED',
          'Pembuatan Guru gagal dan membutuhkan pemulihan manual',
        );
      }
      throw new AppError(500, 'TEACHER_CREATE_FAILED', 'Profil Guru tidak dapat dibuat');
    }

    const teacher = toTeacher(profile);
    try {
      await this.writeAudit(
        actorId,
        'TEACHER_CREATED',
        teacherId,
        null,
        auditSnapshot(teacher),
      );
    } catch (error) {
      const { error: profileRollbackError } = await this.client
        .from('profiles')
        .delete()
        .eq('id', teacherId);
      const { error: authRollbackError } =
        await this.client.auth.admin.deleteUser(teacherId);
      if (profileRollbackError || authRollbackError) {
        throw new AppError(
          500,
          'TEACHER_CONSISTENCY_FAILED',
          'Pembuatan Guru gagal dan membutuhkan pemulihan manual',
        );
      }
      throw error;
    }
    return teacher;
  }

  async update(
    actorId: string,
    teacherId: string,
    input: UpdateTeacherRequest,
  ): Promise<Teacher> {
    const before = await this.loadTeacher(teacherId);
    const nextNip = input.nip?.toLowerCase() ?? before.nip;
    const nextFullName = input.fullName ?? before.fullName;
    if (nextNip === before.nip && nextFullName === before.fullName) return before;

    if (nextNip !== before.nip) {
      const { data: duplicate, error } = await this.client
        .from('profiles')
        .select('id')
        .eq('nip', nextNip)
        .neq('id', teacherId)
        .maybeSingle();
      if (error) {
        throw new AppError(500, 'TEACHER_LOOKUP_FAILED', 'NIP tidak dapat diperiksa');
      }
      if (duplicate) {
        throw new AppError(409, 'NIP_ALREADY_EXISTS', 'NIP sudah digunakan');
      }

      const { error: authError } = await this.client.auth.admin.updateUserById(
        teacherId,
        { email: internalEmailForNip(nextNip), email_confirm: true },
      );
      if (authError) {
        const identityConflict = isAuthIdentityConflict(authError.code);
        throw new AppError(
          identityConflict ? 409 : 500,
          identityConflict ? 'NIP_ALREADY_EXISTS' : 'TEACHER_UPDATE_FAILED',
          identityConflict ? 'NIP sudah digunakan' : 'NIP Auth tidak dapat diperbarui',
        );
      }
    }

    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .update({ nip: nextNip, full_name: nextFullName })
      .eq('id', teacherId)
      .eq('role', 'USER')
      .select(PROFILE_FIELDS)
      .single();
    if (profileError || !profile) {
      if (nextNip !== before.nip) {
        const { error: rollbackError } =
          await this.client.auth.admin.updateUserById(teacherId, {
            email: internalEmailForNip(before.nip),
            email_confirm: true,
          });
        if (rollbackError) {
          throw new AppError(
            500,
            'TEACHER_CONSISTENCY_FAILED',
            'Perubahan NIP gagal dan membutuhkan pemulihan manual',
          );
        }
      }
      throw new AppError(
        profileError?.code === '23505' ? 409 : 500,
        profileError?.code === '23505' ? 'NIP_ALREADY_EXISTS' : 'TEACHER_UPDATE_FAILED',
        profileError?.code === '23505' ? 'NIP sudah digunakan' : 'Profil Guru tidak dapat diperbarui',
      );
    }

    const after = toTeacher(profile);
    try {
      await this.writeAudit(
        actorId,
        'TEACHER_PROFILE_UPDATED',
        teacherId,
        auditSnapshot(before),
        auditSnapshot(after),
      );
    } catch (error) {
      const { error: profileRollbackError } = await this.client
        .from('profiles')
        .update({ nip: before.nip, full_name: before.fullName })
        .eq('id', teacherId);
      const { error: authRollbackError } =
        nextNip === before.nip
          ? { error: null }
          : await this.client.auth.admin.updateUserById(teacherId, {
              email: internalEmailForNip(before.nip),
              email_confirm: true,
            });
      if (profileRollbackError || authRollbackError) {
        throw new AppError(
          500,
          'TEACHER_CONSISTENCY_FAILED',
          'Perubahan Guru gagal dan membutuhkan pemulihan manual',
        );
      }
      throw error;
    }
    return after;
  }

  async setActive(
    actorId: string,
    teacherId: string,
    isActive: boolean,
  ): Promise<Teacher> {
    const before = await this.loadTeacher(teacherId);
    if (before.isActive === isActive) return before;
    const { data, error } = await this.client
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', teacherId)
      .eq('role', 'USER')
      .select(PROFILE_FIELDS)
      .single();
    if (error || !data) {
      throw new AppError(500, 'TEACHER_UPDATE_FAILED', 'Status Guru tidak dapat diperbarui');
    }

    const after = toTeacher(data);
    try {
      await this.writeAudit(
        actorId,
        isActive ? 'TEACHER_ACTIVATED' : 'TEACHER_DEACTIVATED',
        teacherId,
        auditSnapshot(before),
        auditSnapshot(after),
      );
    } catch (auditError) {
      const { error: rollbackError } = await this.client
        .from('profiles')
        .update({ is_active: before.isActive })
        .eq('id', teacherId);
      if (rollbackError) {
        throw new AppError(500, 'TEACHER_CONSISTENCY_FAILED', 'Status Guru membutuhkan pemulihan manual');
      }
      throw auditError;
    }
    return after;
  }

  async resetPassword(
    actorId: string,
    teacherId: string,
    input: ResetTeacherPasswordRequest,
  ): Promise<Teacher> {
    const before = await this.loadTeacher(teacherId);
    if (!before.mustChangePassword) {
      const { error: profileError } = await this.client
        .from('profiles')
        .update({ must_change_password: true })
        .eq('id', teacherId)
        .eq('role', 'USER');
      if (profileError) {
        throw new AppError(500, 'PASSWORD_RESET_FAILED', 'Profil Guru tidak dapat disiapkan');
      }
    }

    const { error: authError } = await this.client.auth.admin.updateUserById(
      teacherId,
      { password: input.temporaryPassword },
    );
    if (authError) {
      if (!before.mustChangePassword) {
        const { error: rollbackError } = await this.client
          .from('profiles')
          .update({ must_change_password: false })
          .eq('id', teacherId);
        if (rollbackError) {
          throw new AppError(
            500,
            'TEACHER_CONSISTENCY_FAILED',
            'Reset password gagal dan membutuhkan pemulihan manual',
          );
        }
      }
      throw new AppError(422, 'PASSWORD_RESET_FAILED', 'Password sementara tidak dapat digunakan');
    }

    const after = await this.loadTeacher(teacherId);
    await this.writeAudit(
      actorId,
      'TEACHER_PASSWORD_RESET',
      teacherId,
      auditSnapshot(before),
      auditSnapshot(after),
    );
    return after;
  }
}
