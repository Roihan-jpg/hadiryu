import {
  PasswordResetResponseSchema,
  TeacherListResponseSchema,
  TeacherSchema,
  type CreateTeacherRequest,
  type ListTeachersQuery,
  type PasswordResetResult,
  type Teacher,
  type TeacherListResponse,
  type UpdateTeacherRequest,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { AppError } from './auth.js';
import {
  hashPassword,
  type SupabaseAuthConfig,
} from './supabase-auth.js';
import type { TeacherService } from './teachers.js';

const TeacherProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: z.string(),
  full_name: z.string(),
  whatsapp_number: z.string().nullable(),
  gender: z.enum(['FEMALE', 'MALE']).nullable().optional(),
  role: z.enum(['USER', 'SECURITY_GUARD']),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const PROFILE_FIELDS =
  'id,nip,full_name,whatsapp_number,gender,role,is_active,created_at,updated_at';

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
    whatsappNumber: row.whatsapp_number,
    gender: row.gender ?? null,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: false,
    temporaryPasswordExpiresAt: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function auditSnapshot(teacher: Teacher) {
  return {
    nip: teacher.nip,
    fullName: teacher.fullName,
    whatsappNumber: teacher.whatsappNumber,
    gender: teacher.gender,
    role: teacher.role,
    isActive: teacher.isActive,
  };
}

export function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = `${upper}${lower}${digits}`;
  const bytes = randomBytes(8);
  const characters = [
    upper[bytes[0]! % upper.length]!,
    lower[bytes[1]! % lower.length]!,
    digits[bytes[2]! % digits.length]!,
    ...Array.from({ length: 5 }, (_, index) =>
      alphabet[bytes[index + 3]! % alphabet.length]!),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index]! % (index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex]!, characters[index]!];
  }
  return characters.join('');
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
      .in('role', ['USER', 'SECURITY_GUARD'])
      .maybeSingle();
    if (error) throw new AppError(500, 'TEACHER_LOOKUP_FAILED', 'Data Guru tidak dapat dimuat');
    if (!data) throw new AppError(404, 'TEACHER_NOT_FOUND', 'Guru tidak ditemukan');
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
    if (error) throw new AppError(500, 'AUDIT_WRITE_FAILED', 'Audit Guru tidak dapat dicatat');
  }

  private async revokeSessions(teacherId: string): Promise<void> {
    const { error } = await this.client
      .from('app_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('profile_id', teacherId)
      .is('revoked_at', null);
    if (error) throw new AppError(500, 'SESSION_REVOKE_FAILED', 'Sesi Guru tidak dapat dicabut');
  }

  async list(input: ListTeachersQuery): Promise<TeacherListResponse> {
    const start = (input.page - 1) * input.pageSize;
    const end = start + input.pageSize - 1;
    let query = this.client
      .from('profiles')
      .select(PROFILE_FIELDS, { count: 'exact' })
      .in('role', ['USER', 'SECURITY_GUARD'])
      .order('full_name', { ascending: true })
      .order('nip', { ascending: true })
      .range(start, end);
    if (input.search) {
      query = query.or(`nip.ilike.%${input.search}%,full_name.ilike.%${input.search}%`);
    }
    if (input.isActive !== undefined) query = query.eq('is_active', input.isActive);
    if (input.role !== undefined) query = query.eq('role', input.role);

    const { data, error, count } = await query;
    if (error) throw new AppError(500, 'TEACHER_LIST_FAILED', 'Daftar Guru tidak dapat dimuat');
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
    if (lookupError) throw new AppError(500, 'TEACHER_LOOKUP_FAILED', 'NIP tidak dapat diperiksa');
    if (existing) throw new AppError(409, 'NIP_ALREADY_EXISTS', 'NIP sudah digunakan');

    const teacherId = randomUUID();
    const { data: profile, error: profileError } = await this.client
      .from('profiles')
      .insert({
        id: teacherId,
        nip,
        full_name: input.fullName,
        whatsapp_number: input.whatsappNumber ?? null,
        gender: input.gender,
        role: input.role ?? 'USER',
        is_active: true,
        must_change_password: false,
        temporary_password_expires_at: null,
      })
      .select(PROFILE_FIELDS)
      .single();
    if (profileError || !profile) {
      throw new AppError(
        profileError?.code === '23505' ? 409 : 500,
        profileError?.code === '23505' ? 'NIP_ALREADY_EXISTS' : 'TEACHER_CREATE_FAILED',
        profileError?.code === '23505' ? 'NIP sudah digunakan' : 'Profil Guru tidak dapat dibuat',
      );
    }

    const { error: accountError } = await this.client.from('app_accounts').insert({
      profile_id: teacherId,
      password_hash: await hashPassword(input.initialPassword),
    });
    if (accountError) {
      await this.client.from('profiles').delete().eq('id', teacherId);
      throw new AppError(500, 'TEACHER_CREATE_FAILED', 'Akun Guru tidak dapat dibuat');
    }

    const teacher = toTeacher(profile);
    try {
      await this.writeAudit(actorId, 'TEACHER_CREATED', teacherId, null, auditSnapshot(teacher));
    } catch (error) {
      await this.client.from('app_accounts').delete().eq('profile_id', teacherId);
      await this.client.from('profiles').delete().eq('id', teacherId);
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
    const nextWhatsappNumber = input.whatsappNumber === undefined
      ? before.whatsappNumber
      : input.whatsappNumber;
    const nextGender = input.gender === undefined ? before.gender : input.gender;
    if (
      nextNip === before.nip &&
      nextFullName === before.fullName &&
      nextWhatsappNumber === before.whatsappNumber &&
      nextGender === before.gender
    ) return before;

    const { data, error } = await this.client
      .from('profiles')
      .update({ nip: nextNip, full_name: nextFullName, whatsapp_number: nextWhatsappNumber, gender: nextGender })
      .eq('id', teacherId)
      .in('role', ['USER', 'SECURITY_GUARD'])
      .select(PROFILE_FIELDS)
      .single();
    if (error || !data) {
      throw new AppError(
        error?.code === '23505' ? 409 : 500,
        error?.code === '23505' ? 'NIP_ALREADY_EXISTS' : 'TEACHER_UPDATE_FAILED',
        error?.code === '23505' ? 'NIP sudah digunakan' : 'Profil Guru tidak dapat diperbarui',
      );
    }

    const after = toTeacher(data);
    try {
      await this.writeAudit(actorId, 'TEACHER_PROFILE_UPDATED', teacherId, auditSnapshot(before), auditSnapshot(after));
    } catch (auditError) {
      await this.client.from('profiles').update({
        nip: before.nip,
        full_name: before.fullName,
        whatsapp_number: before.whatsappNumber,
        gender: before.gender,
      }).eq('id', teacherId);
      throw auditError;
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
    if (!isActive && before.role === 'SECURITY_GUARD') {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const { data: roster, error: rosterError } = await this.client
        .from('security_schedule_settings')
        .select('id')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`)
        .or(`day_one_morning_guard_id.eq.${teacherId},day_one_night_guard_id.eq.${teacherId},day_one_off_guard_id.eq.${teacherId}`)
        .limit(1)
        .maybeSingle();
      if (rosterError) throw new AppError(500, 'TEACHER_UPDATE_FAILED', 'Roster Satpam tidak dapat diperiksa');
      if (roster) {
        throw new AppError(
          409,
          'SECURITY_GUARD_IN_ACTIVE_ROSTER',
          'Satpam masih berada dalam roster aktif. Ganti roster terlebih dahulu',
        );
      }
    }
    const { data, error } = await this.client
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', teacherId)
      .in('role', ['USER', 'SECURITY_GUARD'])
      .select(PROFILE_FIELDS)
      .single();
    if (error || !data) {
      const activeRosterConflict = error?.message?.includes('SECURITY_GUARD_IN_ACTIVE_ROSTER');
      throw new AppError(
        activeRosterConflict ? 409 : 500,
        activeRosterConflict ? 'SECURITY_GUARD_IN_ACTIVE_ROSTER' : 'TEACHER_UPDATE_FAILED',
        activeRosterConflict
          ? 'Satpam masih berada dalam roster aktif. Ganti roster terlebih dahulu'
          : 'Status akun tidak dapat diperbarui',
      );
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
      if (!isActive) await this.revokeSessions(teacherId);
    } catch (operationError) {
      await this.client.from('profiles').update({ is_active: before.isActive }).eq('id', teacherId);
      throw operationError;
    }
    return after;
  }

  async resetPassword(actorId: string, teacherId: string): Promise<PasswordResetResult> {
    const teacher = await this.loadTeacher(teacherId);
    const newPassword = generatePassword();
    const { error } = await this.client.from('app_accounts').update({
      password_hash: await hashPassword(newPassword),
      password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    }).eq('profile_id', teacherId).select('profile_id').single();
    if (error) throw new AppError(500, 'PASSWORD_RESET_FAILED', 'Password Guru tidak dapat direset');

    await this.revokeSessions(teacherId);
    await this.writeAudit(
      actorId,
      'TEACHER_PASSWORD_RESET',
      teacherId,
      auditSnapshot(teacher),
      auditSnapshot(teacher),
    );
    return PasswordResetResponseSchema.parse({ teacher, newPassword });
  }
}
