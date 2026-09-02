import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import { SupabaseSettingsService } from './supabase-settings.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(sourceDirectory, '../../..');
const supabaseCliPath = join(
  repositoryRoot,
  'node_modules',
  'supabase',
  'dist',
  'supabase.js',
);
const calendarDate = '2099-12-25';

interface LocalStatus {
  API_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
}

function runSupabase(args: string[]) {
  return spawnSync(process.execPath, [supabaseCliPath, '--workdir', repositoryRoot, ...args], {
    encoding: 'utf8',
  });
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
  if (!status) throw new Error([started.stdout, started.stderr].filter(Boolean).join('\n'));
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

describe('SupabaseSettingsService calendar integration', () => {
  let client: SupabaseClient;
  let publicClient: SupabaseClient;
  let service: SupabaseSettingsService;
  let adminId: string;

  beforeAll(async () => {
    const status = ensureLocalAuth();
    const config: SupabaseAuthConfig = {
      url: status.API_URL,
      publishableKey: status.PUBLISHABLE_KEY,
      secretKey: status.SECRET_KEY,
    };
    client = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    publicClient = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    service = new SupabaseSettingsService(config);
    const nip = `t06-admin-${randomUUID()}`;
    const { data, error } = await client.auth.admin.createUser({
      email: internalEmailForNip(nip),
      password: `Admin-${randomUUID()}!`,
      email_confirm: true,
      app_metadata: { role: 'SUPER_ADMIN' },
    });
    if (error) throw error;
    adminId = data.user.id;
    const { error: profileError } = await client.from('profiles').insert({
      id: adminId,
      nip,
      full_name: 'Admin T06',
      role: 'SUPER_ADMIN',
      is_active: true,
      must_change_password: false,
    });
    if (profileError) throw profileError;
  }, 120_000);

  afterAll(async () => {
    if (!client || !adminId) return;
    runSql(`set session_replication_role = replica;
      delete from public.audit_logs where actor_id = '${adminId}';
      delete from public.calendar_exceptions where work_date in ('${calendarDate}', '2099-12-26');
      delete from public.profiles where id = '${adminId}';`);
    await client.auth.admin.deleteUser(adminId);
  });

  it('creates, updates, and deletes future calendar dates with auditable history', async () => {
    const created = await service.createCalendarException(adminId, {
      workDate: calendarDate,
      exceptionType: 'HOLIDAY',
      name: 'Libur Natal',
      scheduleType: null,
    });
    const updated = await service.updateCalendarException(adminId, created.id, {
      workDate: '2099-12-26',
      exceptionType: 'WORKING_DAY',
      name: 'Hari kerja pengganti',
      scheduleType: 'SATURDAY',
    });
    const listed = await service.listCalendarExceptions();

    expect(listed.exceptions).toContainEqual(updated);
    await service.deleteCalendarException(adminId, updated.id);
    const { data: audits } = await client
      .from('audit_logs')
      .select('action,before_data,after_data')
      .eq('actor_id', adminId)
      .like('action', 'CALENDAR_EXCEPTION_%')
      .order('created_at');
    expect(audits?.map((audit) => audit.action)).toEqual([
      'CALENDAR_EXCEPTION_CREATED',
      'CALENDAR_EXCEPTION_UPDATED',
      'CALENDAR_EXCEPTION_DELETED',
    ]);
    expect(audits?.[1]?.before_data).toMatchObject({ workDate: calendarDate });
    expect(audits?.[2]?.after_data).toBeNull();
  });

  it('rejects calendar history and keeps calendar mutations unavailable to browser roles', async () => {
    await expect(
      service.createCalendarException(adminId, {
        workDate: '2026-01-01',
        exceptionType: 'HOLIDAY',
        name: 'Libur historis',
        scheduleType: null,
      }),
    ).rejects.toMatchObject({ code: 'CALENDAR_DATE_IN_PAST' } satisfies Partial<AppError>);
    const { error } = await publicClient.from('calendar_exceptions').insert({
      work_date: '2099-12-27',
      exception_type: 'HOLIDAY',
      name: 'Tidak boleh',
      schedule_type: null,
    });
    expect(error).toBeTruthy();
  });
});
