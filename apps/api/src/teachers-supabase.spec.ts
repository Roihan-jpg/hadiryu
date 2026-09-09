import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  SupabaseAuthService,
  type SupabaseAuthConfig,
} from './supabase-auth.js';
import { SupabaseTeacherService } from './supabase-teachers.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const supabaseCliPath = path.join(
  repositoryRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
);

interface LocalStatus {
  API_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
}

function runSupabase(args: string[]) {
  return spawnSync(
    process.execPath,
    [supabaseCliPath, '--workdir', repositoryRoot, ...args],
    { encoding: 'utf8' },
  );
}

function readStatus(): LocalStatus | undefined {
  const result = runSupabase(['status', '-o', 'json']);
  if (result.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as Partial<LocalStatus>;
    return parsed.API_URL && parsed.PUBLISHABLE_KEY && parsed.SECRET_KEY
      ? (parsed as LocalStatus)
      : undefined;
  } catch {
    return undefined;
  }
}

function ensureLocalAuth(): LocalStatus {
  const current = readStatus();
  if (current) return current;

  runSupabase(['stop']);
  const started = runSupabase([
    'start',
    '--exclude',
    'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit',
  ]);
  const status = readStatus();
  if (!status) {
    throw new Error([started.stdout, started.stderr].filter(Boolean).join('\n'));
  }
  return status;
}

function runSql(sql: string): void {
  const result = spawnSync(
    'docker',
    [
      'exec',
      'supabase_db_absensi-guru',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
  }
}

describe('SupabaseTeacherService integration', () => {
  let config: SupabaseAuthConfig;
  let serviceClient: SupabaseClient;
  let teacherService: SupabaseTeacherService;
  let authService: SupabaseAuthService;
  let adminId: string;
  let localReady = false;
  const cleanupUserIds: string[] = [];

  beforeAll(async () => {
    const status = ensureLocalAuth();
    config = {
      url: status.API_URL,
      publishableKey: status.PUBLISHABLE_KEY,
      secretKey: status.SECRET_KEY,
    };
    serviceClient = createClient(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    localReady = true;
    teacherService = new SupabaseTeacherService(config);
    authService = new SupabaseAuthService(config);

    const nip = `t04-admin-${randomUUID()}`;
    adminId = randomUUID();
    cleanupUserIds.push(adminId);
    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: adminId,
      nip,
      full_name: 'Admin T04',
      role: 'SUPER_ADMIN',
      is_active: true,
      must_change_password: false,
    });
    if (profileError) throw profileError;
  }, 120_000);

  afterAll(async () => {
    if (!localReady) return;
    runSql('drop trigger if exists t04_reject_nip_update on public.profiles; drop trigger if exists t04_reject_profile_insert on public.profiles; drop function if exists private.t04_reject_nip_update(); drop function if exists private.t04_reject_profile_insert();');
    if (cleanupUserIds.length === 0) return;
    const ids = cleanupUserIds.map((id) => `'${id}'`).join(',');
    runSql(`set session_replication_role = replica; delete from public.audit_logs where actor_id in (${ids}) or entity_id in (${ids}); delete from public.app_sessions where profile_id in (${ids}); delete from public.app_accounts where profile_id in (${ids}); delete from public.profiles where id in (${ids});`);
  });

  async function createTeacher(label: string) {
    const safeLabel = label.toLowerCase().replaceAll(' ', '-');
    const nip = `t04-${safeLabel}-${randomUUID()}`;
    const password = 'Guru1234';
    const teacher = await teacherService.create(adminId, {
      nip,
      fullName: `Guru ${label}`,
      initialPassword: password,
    });
    cleanupUserIds.push(teacher.id);
    return { teacher, password };
  }

  it('creates USER application accounts and profiles, then lists them with search and pagination', async () => {
    const searchLabel = `Pencarian-${randomUUID().slice(0, 8)}`;
    const first = await createTeacher(`${searchLabel} Satu`);
    await createTeacher(`${searchLabel} Dua`);

    const result = await teacherService.list({
      search: searchLabel,
      page: 1,
      pageSize: 1,
    });
    const { count: accountCount } = await serviceClient
      .from('app_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', first.teacher.id);

    expect(result.data).toHaveLength(1);
    expect(result.pagination).toMatchObject({ totalItems: 2, totalPages: 2 });
    expect(accountCount).toBe(1);
    await expect(
      authService.login({ nip: first.teacher.nip, password: first.password }),
    ).resolves.toMatchObject({ user: { id: first.teacher.id, role: 'USER' } });
  });

  it('updates the profile NIP and records a password-free audit', async () => {
    const { teacher, password } = await createTeacher('Ubah NIP');
    const newNip = `t04-updated-${randomUUID()}`;

    const updated = await teacherService.update(adminId, teacher.id, {
      nip: newNip,
      fullName: 'Guru Setelah Diubah',
    });
    const { data: audit } = await serviceClient
      .from('audit_logs')
      .select('before_data,after_data')
      .eq('entity_id', teacher.id)
      .eq('action', 'TEACHER_PROFILE_UPDATED')
      .single();

    expect(updated).toMatchObject({ nip: newNip, fullName: 'Guru Setelah Diubah' });
    await expect(authService.login({ nip: newNip, password })).resolves.toMatchObject({
      user: { id: teacher.id },
    });
    await expect(authService.login({ nip: teacher.nip, password })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    } satisfies Partial<AppError>);
    expect(audit?.before_data).toMatchObject({ nip: teacher.nip });
    expect(JSON.stringify(audit)).not.toContain('password');
  });

  it('does not leave an application account when profile creation fails', async () => {
    const nip = `t04-rejected-create-${randomUUID()}`;
    const password = 'Tolak123';
    runSql(`create or replace function private.t04_reject_profile_insert() returns trigger language plpgsql security invoker set search_path = '' as $$ begin if new.nip = '${nip}' then raise exception 'forced T04 profile insert failure'; end if; return new; end; $$; create trigger t04_reject_profile_insert before insert on public.profiles for each row execute function private.t04_reject_profile_insert();`);

    await expect(
      teacherService.create(adminId, {
        nip,
        fullName: 'Guru Gagal Dibuat',
        initialPassword: password,
      }),
    ).rejects.toMatchObject({ code: 'TEACHER_CREATE_FAILED' } satisfies Partial<AppError>);
    await expect(authService.login({ nip, password })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    } satisfies Partial<AppError>);

    runSql('drop trigger t04_reject_profile_insert on public.profiles; drop function private.t04_reject_profile_insert();');
  });

  it('leaves the profile NIP unchanged when its update fails', async () => {
    const { teacher } = await createTeacher('Rollback');
    const rejectedNip = `t04-rejected-${randomUUID()}`;
    runSql(`create or replace function private.t04_reject_nip_update() returns trigger language plpgsql security invoker set search_path = '' as $$ begin if new.nip = '${rejectedNip}' then raise exception 'forced T04 profile failure'; end if; return new; end; $$; create trigger t04_reject_nip_update before update on public.profiles for each row execute function private.t04_reject_nip_update();`);

    await expect(
      teacherService.update(adminId, teacher.id, { nip: rejectedNip }),
    ).rejects.toMatchObject({ code: 'TEACHER_UPDATE_FAILED' } satisfies Partial<AppError>);

    const { data: profile } = await serviceClient
      .from('profiles')
      .select('nip')
      .eq('id', teacher.id)
      .single();
    expect(profile?.nip).toBe(teacher.nip);

    runSql('drop trigger t04_reject_nip_update on public.profiles; drop function private.t04_reject_nip_update();');
  });

  it('activates and deactivates without deleting the teacher profile', async () => {
    const { teacher } = await createTeacher('Status');

    const inactive = await teacherService.setActive(adminId, teacher.id, false);
    const active = await teacherService.setActive(adminId, teacher.id, true);
    const { count } = await serviceClient
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('id', teacher.id);

    expect(inactive.isActive).toBe(false);
    expect(active.isActive).toBe(true);
    expect(count).toBe(1);
  });

  it('resets the Auth password, forces initial-password flow, and omits the secret from audit', async () => {
    const account = await createTeacher('Reset Password');
    await serviceClient
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', account.teacher.id);
    const result = await teacherService.resetPassword(adminId, account.teacher.id);
    const { newPassword } = result;
    const { data: audit } = await serviceClient
      .from('audit_logs')
      .select('before_data,after_data')
      .eq('entity_id', account.teacher.id)
      .eq('action', 'TEACHER_PASSWORD_RESET')
      .single();

    expect(result.teacher.mustChangePassword).toBe(false);
    expect(result.teacher.temporaryPasswordExpiresAt).toBeNull();
    await expect(
      authService.login({ nip: account.teacher.nip, password: newPassword }),
    ).resolves.toMatchObject({ user: { mustChangePassword: false } });
    await expect(
      authService.login({ nip: account.teacher.nip, password: account.password }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(JSON.stringify(audit)).not.toContain(newPassword);
    expect(audit?.before_data).not.toHaveProperty('temporaryPassword');
    expect(audit?.after_data).not.toHaveProperty('temporaryPassword');
  });
});
