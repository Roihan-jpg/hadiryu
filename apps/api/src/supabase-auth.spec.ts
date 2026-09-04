import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  SupabaseAuthService,
  bootstrapSuperAdmin,
  internalEmailForNip,
  type SupabaseAuthConfig,
} from './supabase-auth.js';

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

describe('SupabaseAuthService integration', () => {
  let config: SupabaseAuthConfig;
  let serviceClient: SupabaseClient;
  let authService: SupabaseAuthService;
  const cleanupUserIds: string[] = [];

  beforeAll(() => {
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
    authService = new SupabaseAuthService(config);
  }, 120_000);

  afterAll(async () => {
    if (cleanupUserIds.length === 0) return;
    const ids = cleanupUserIds.map((id) => `'${id}'`).join(',');
    const cleanup = spawnSync(
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
        `set session_replication_role = replica; delete from public.audit_logs where actor_id in (${ids}); delete from public.profiles where id in (${ids});`,
      ],
      { encoding: 'utf8' },
    );
    if (cleanup.status !== 0) {
      throw new Error([cleanup.stdout, cleanup.stderr].filter(Boolean).join('\n'));
    }
    for (const userId of cleanupUserIds) {
      await serviceClient.auth.admin.deleteUser(userId);
    }
  });

  async function createAccount(options: {
    role: 'USER' | 'SUPER_ADMIN';
    isActive?: boolean;
    mustChangePassword?: boolean;
    temporaryPasswordExpiresAt?: string | null;
    password?: string;
  }) {
    const nip = `t03-${options.role.toLowerCase()}-${randomUUID()}`;
    const password = options.password ?? `T03-${randomUUID()}!`;
    const { data, error } = await serviceClient.auth.admin.createUser({
      email: internalEmailForNip(nip),
      password,
      email_confirm: true,
      app_metadata: { role: options.role },
    });
    if (error) throw error;
    cleanupUserIds.push(data.user.id);
    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: data.user.id,
      nip,
      full_name: `${options.role} Test`,
      role: options.role,
      is_active: options.isActive ?? true,
      must_change_password: options.mustChangePassword ?? true,
      temporary_password_expires_at: options.temporaryPasswordExpiresAt ?? null,
    });
    if (profileError) throw profileError;
    return { nip, password, id: data.user.id };
  }

  it('maps a normalized textual NIP to a private Auth identity', () => {
    expect(internalEmailForNip('  Guru-001 ')).toBe(
      'guru-001@absensi.invalid',
    );
  });

  it('logs in USER and SUPER_ADMIN using the current database role', async () => {
    const teacher = await createAccount({ role: 'USER' });
    const admin = await createAccount({ role: 'SUPER_ADMIN' });

    const teacherSession = await authService.login({
      nip: teacher.nip,
      password: teacher.password,
    });
    const adminSession = await authService.login({
      nip: admin.nip,
      password: admin.password,
    });

    expect(teacherSession.user.role).toBe('USER');
    expect(adminSession.user.role).toBe('SUPER_ADMIN');
    expect(teacherSession.user).not.toHaveProperty('email');
  });

  it('rotates refresh tokens and reloads the active profile', async () => {
    const account = await createAccount({
      role: 'USER',
      mustChangePassword: false,
    });
    const login = await authService.login(account);

    const refreshed = await authService.refresh(login.refreshToken);

    expect(refreshed.refreshToken).not.toBe(login.refreshToken);
    expect(refreshed.user.id).toBe(account.id);
    await expect(authService.authenticate(refreshed.accessToken)).resolves.toMatchObject({
      id: account.id,
      isActive: true,
    });
  });

  it('rejects an inactive account during login and after deactivation', async () => {
    const inactive = await createAccount({ role: 'USER', isActive: false });
    await expect(authService.login(inactive)).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    } satisfies Partial<AppError>);

    const active = await createAccount({ role: 'USER' });
    const session = await authService.login(active);
    await serviceClient
      .from('profiles')
      .update({ is_active: false })
      .eq('id', active.id);

    await expect(authService.authenticate(session.accessToken)).rejects.toMatchObject({
      code: 'ACCOUNT_INACTIVE',
    } satisfies Partial<AppError>);
  });

  it('rejects an expired temporary password before issuing an application session', async () => {
    const expired = await createAccount({
      role: 'USER',
      mustChangePassword: true,
      temporaryPasswordExpiresAt: '2020-01-01T00:00:00.000Z',
    });

    await expect(authService.login(expired)).rejects.toMatchObject({
      code: 'TEMPORARY_PASSWORD_EXPIRED',
    } satisfies Partial<AppError>);
  });

  it('changes the initial password and removes the first-login restriction', async () => {
    const account = await createAccount({ role: 'USER' });
    const initialSession = await authService.login(account);
    const newPassword = `Baru-${randomUUID()}!`;

    const changed = await authService.changePassword(
      initialSession.accessToken,
      initialSession.refreshToken,
      { currentPassword: account.password, newPassword },
    );

    expect(changed.user.mustChangePassword).toBe(false);
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('temporary_password_expires_at')
      .eq('id', account.id)
      .single();
    expect(profile?.temporary_password_expires_at).toBeNull();
    await expect(
      authService.login({ nip: account.nip, password: newPassword }),
    ).resolves.toMatchObject({ user: { mustChangePassword: false } });
    await expect(authService.login(account)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('bootstraps one idempotent SuperAdmin with app metadata and an audit event', async () => {
    const result = await bootstrapSuperAdmin(config, {
      nip: 't03-bootstrap-super-admin',
      fullName: 'SuperAdmin Bootstrap Test',
      password: `Bootstrap-${randomUUID()}!`,
    });
    cleanupUserIds.push(result.id);
    const repeated = await bootstrapSuperAdmin(config, {
      nip: 't03-bootstrap-super-admin',
      fullName: 'SuperAdmin Bootstrap Test',
      password: `Ignored-${randomUUID()}!`,
    });
    const { data: authUser } = await serviceClient.auth.admin.getUserById(
      result.id,
    );
    const { count } = await serviceClient
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('actor_id', result.id)
      .eq('action', 'SUPER_ADMIN_BOOTSTRAPPED');

    expect(repeated.id).toBe(result.id);
    expect(result.role).toBe('SUPER_ADMIN');
    expect(authUser.user?.app_metadata['role']).toBe('SUPER_ADMIN');
    expect(count).toBe(1);
  });
});
