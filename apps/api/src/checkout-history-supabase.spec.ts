import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAttendanceService } from './attendance.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';

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

function ensureLocalSupabase(): LocalStatus {
  const current = readStatus();
  if (current) return current;
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

describe('Supabase checkout and history integration', () => {
  let adminClient: SupabaseClient;
  let config: SupabaseAuthConfig;
  let teacherClient: SupabaseClient;
  let teacherId: string;
  let teacherEmail: string;
  let teacherPassword: string;

  beforeAll(async () => {
    const status = ensureLocalSupabase();
    config = {
      url: status.API_URL,
      publishableKey: status.PUBLISHABLE_KEY,
      secretKey: status.SECRET_KEY,
    };
    adminClient = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    teacherClient = createClient(config.url, config.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const nip = `t08-${randomUUID()}`;
    teacherEmail = internalEmailForNip(nip);
    teacherPassword = `Teacher-${randomUUID()}!`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email: teacherEmail,
      password: teacherPassword,
      email_confirm: true,
      app_metadata: { role: 'USER' },
    });
    if (error) throw error;
    teacherId = data.user.id;
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: teacherId,
      nip,
      full_name: 'Guru Checkout',
      role: 'USER',
      is_active: true,
      must_change_password: false,
    });
    if (profileError) throw profileError;
  }, 120_000);

  afterAll(async () => {
    if (!adminClient || !teacherId) return;
    runSql(`delete from public.attendance_records where teacher_id = '${teacherId}';
      delete from public.profiles where id = '${teacherId}';`);
    await adminClient.auth.admin.deleteUser(teacherId);
  });

  it('atomically completes checkout once and returns the winner to concurrent repeats', async () => {
    const repository = new SupabaseAttendanceRepository(config);
    const location = {
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    };
    await createAttendanceService(
      repository,
      () => new Date('2099-01-05T00:05:20.000Z'),
    ).checkIn(teacherId, location);

    const checkoutService = createAttendanceService(
      repository,
      () => new Date('2099-01-05T08:35:59.000Z'),
    );
    const [first, repeated] = await Promise.all([
      checkoutService.checkout(teacherId, location),
      checkoutService.checkout(teacherId, location),
    ]);
    const { data, error } = await adminClient
      .from('attendance_records')
      .select(
        'check_in_at,check_out_at,target_minutes,worked_minutes,work_deficit_minutes,status',
      )
      .eq('teacher_id', teacherId)
      .eq('work_date', '2099-01-05')
      .single();
    if (error) throw error;

    expect(repeated).toEqual(first);
    expect(data).toMatchObject({
      check_in_at: '2099-01-05T00:05:20+00:00',
      check_out_at: '2099-01-05T08:35:59+00:00',
      worked_minutes: 510,
      status: 'COMPLETED',
    });
    expect(data.work_deficit_minutes).toBe(
      Math.max(0, data.target_minutes - data.worked_minutes),
    );
  });

  it('paginates own history and derives a past open record as incomplete', async () => {
    const repository = new SupabaseAttendanceRepository(config);
    await createAttendanceService(
      repository,
      () => new Date('2099-01-06T00:00:00.000Z'),
    ).checkIn(teacherId, {
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });

    const result = await createAttendanceService(
      repository,
      () => new Date('2099-01-07T01:00:00.000Z'),
    ).history(teacherId, { page: 1, pageSize: 1, month: '2099-01' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      workDate: '2099-01-06',
      checkOutAt: null,
      workDeficitMinutes: 60,
      status: 'INCOMPLETE',
    });
    const record = result.data[0];
    expect(record?.status).toBe('INCOMPLETE');
    if (record?.status !== 'INCOMPLETE') throw new Error('Status tidak lengkap');
    expect(record.workedMinutes).toBe(Math.max(0, record.targetMinutes - 60));
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
  });

  it('keeps checkout writes unavailable to the browser role', async () => {
    const { error: signInError } = await teacherClient.auth.signInWithPassword({
      email: teacherEmail,
      password: teacherPassword,
    });
    if (signInError) throw signInError;
    const { error } = await teacherClient
      .from('attendance_records')
      .update({ status: 'COMPLETED' })
      .eq('teacher_id', teacherId);

    expect(error).toBeTruthy();
  });
});
