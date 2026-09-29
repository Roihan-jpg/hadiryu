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

describe('Supabase check-in integration', () => {
  let adminClient: SupabaseClient;
  let config: SupabaseAuthConfig;
  let teacherClient: SupabaseClient;
  let teacherId: string;
  let teacherPassword: string;
  let teacherEmail: string;

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
    const nip = `t07-${randomUUID()}`;
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
      full_name: 'Guru Check-in',
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

  it('stores one server-timestamped record when concurrent requests repeat', async () => {
    const repository = new SupabaseAttendanceRepository(config);
    const service = createAttendanceService(
      repository,
      () => new Date('2099-01-05T00:05:59.000Z'),
    );
    const location = {
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 50,
    };

    const [first, repeated] = await Promise.all([
      service.checkIn(teacherId, location),
      service.checkIn(teacherId, location),
    ]);
    const { data: rows, error } = await adminClient
      .from('attendance_records')
      .select('work_date,check_in_at,check_in_distance_meters,arrival_late_minutes,status')
      .eq('teacher_id', teacherId);
    if (error) throw error;

    expect(repeated).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      work_date: '2099-01-05',
      check_in_at: '2099-01-05T00:05:59+00:00',
      check_in_distance_meters: 0,
      arrival_late_minutes: 5,
      status: 'CHECKED_IN',
    });
  });

  it('keeps browser-role writes denied while allowing the teacher to read their row', async () => {
    const { error: signInError } = await teacherClient.auth.signInWithPassword({
      email: teacherEmail,
      password: teacherPassword,
    });
    if (signInError) throw signInError;
    const { data: ownRows, error: readError } = await teacherClient
      .from('attendance_records')
      .select('teacher_id,work_date');
    const { error: writeError } = await teacherClient.from('attendance_records').insert({
      teacher_id: teacherId,
      work_date: '2099-01-06',
      check_in_at: '2099-01-06T00:00:00.000Z',
    });

    expect(readError).toBeNull();
    expect(ownRows).toEqual([{ teacher_id: teacherId, work_date: '2099-01-05' }]);
    expect(writeError).toBeTruthy();
  });
});
