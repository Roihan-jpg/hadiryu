import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMonthlyReportService } from './monthly-report.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseMonthlyReportRepository } from './supabase-monthly-report.js';

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
    const value = JSON.parse(result.stdout) as Partial<LocalStatus>;
    return value.API_URL && value.PUBLISHABLE_KEY && value.SECRET_KEY
      ? (value as LocalStatus)
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
  const resolved = readStatus();
  if (!resolved) {
    throw new Error([started.stdout, started.stderr].filter(Boolean).join('\n'));
  }
  return resolved;
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

describe('Supabase monthly report integration', () => {
  let client: SupabaseClient;
  let config: SupabaseAuthConfig;
  let adminId: string;
  let teacherId: string;
  let inactiveTeacherId: string;

  beforeAll(async () => {
    const local = ensureLocalSupabase();
    config = {
      url: local.API_URL,
      publishableKey: local.PUBLISHABLE_KEY,
      secretKey: local.SECRET_KEY,
    };
    client = createClient(config.url, config.secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const users = await Promise.all(
      ['admin', 'teacher', 'inactive'].map(async (kind) => {
        const nip = `t11-${kind}-${randomUUID()}`;
        const { data, error } = await client.auth.admin.createUser({
          email: internalEmailForNip(nip),
          password: `User-${randomUUID()}!`,
          email_confirm: true,
          app_metadata: { role: kind === 'admin' ? 'SUPER_ADMIN' : 'USER' },
        });
        if (error) throw error;
        return { id: data.user.id, nip, kind };
      }),
    );
    adminId = users[0]!.id;
    teacherId = users[1]!.id;
    inactiveTeacherId = users[2]!.id;

    const { error: profileError } = await client.from('profiles').insert([
      {
        id: adminId,
        nip: users[0]!.nip,
        full_name: 'Admin Laporan',
        role: 'SUPER_ADMIN',
        is_active: true,
        must_change_password: false,
      },
      {
        id: teacherId,
        nip: users[1]!.nip,
        full_name: 'Guru Laporan',
        role: 'USER',
        is_active: true,
        must_change_password: false,
      },
      {
        id: inactiveTeacherId,
        nip: users[2]!.nip,
        full_name: 'Guru Nonaktif',
        role: 'USER',
        is_active: false,
        must_change_password: false,
      },
    ]);
    if (profileError) throw profileError;
    runSql(`set session_replication_role = replica;
      update public.profiles
      set created_at = '2026-08-01T00:00:00Z'
      where id in ('${teacherId}', '${inactiveTeacherId}');`);

    const { error: attendanceError } = await client
      .from('attendance_records')
      .insert({
        teacher_id: teacherId,
        work_date: '2026-08-03',
        check_in_at: '2026-08-03T00:00:00.000Z',
        check_in_latitude: -6.2,
        check_in_longitude: 106.816666,
        check_in_accuracy_meters: 5,
        check_in_distance_meters: 2,
        check_out_at: '2026-08-03T08:35:00.000Z',
        check_out_latitude: -6.2,
        check_out_longitude: 106.816666,
        check_out_accuracy_meters: 5,
        check_out_distance_meters: 2,
        work_start: '07:00',
        work_end: '15:35',
        checkout_close: '17:00',
        schedule_type: 'WEEKDAY',
        check_in_open_at: '2026-08-02T23:30:00.000Z',
        work_start_at: '2026-08-03T00:00:00.000Z',
        check_in_close_at: '2026-08-03T01:00:00.000Z',
        checkout_open_at: '2026-08-03T08:00:00.000Z',
        work_end_at: '2026-08-03T08:35:00.000Z',
        checkout_close_at: '2026-08-03T10:00:00.000Z',
        target_minutes: 515,
        worked_minutes: 515,
        arrival_late_minutes: 0,
        work_deficit_minutes: 0,
        status: 'COMPLETED',
      });
    if (attendanceError) throw attendanceError;

    const { error: leaveError } = await client.from('leave_requests').insert({
      teacher_id: teacherId,
      leave_date: '2026-08-04',
      leave_type: 'SICK',
      reason: 'Pemulihan',
      status: 'PENDING',
    });
    if (leaveError) throw leaveError;
  }, 120_000);

  afterAll(async () => {
    if (!client || !teacherId) return;
    runSql(`
      delete from public.leave_requests where teacher_id = '${teacherId}';
      delete from public.attendance_records where teacher_id = '${teacherId}';
      delete from public.profiles where id in ('${teacherId}', '${inactiveTeacherId}', '${adminId}');
    `);
    await client.auth.admin.deleteUser(teacherId);
    await client.auth.admin.deleteUser(inactiveTeacherId);
    await client.auth.admin.deleteUser(adminId);
  });

  it('loads period data, blocks Pending leave, and excludes inactive teachers', async () => {
    const repository = new SupabaseMonthlyReportRepository(config);
    const source = await repository.loadMonth('2026-08-01', '2026-08-31');
    expect(
      source.teachers.find((item) => item.teacherId === teacherId)?.createdDate,
    ).toBe('2026-08-01');
    const service = createMonthlyReportService(
      repository,
      () => new Date('2026-09-01T00:00:00.000Z'),
    );

    await expect(service.preview({ year: 2026, month: 8 })).rejects.toMatchObject({
      code: 'PENDING_LEAVE_EXISTS',
    });

    runSql(`delete from public.leave_requests
      where teacher_id = '${teacherId}' and leave_date = '2026-08-04';`);
    const result = await service.preview({ year: 2026, month: 8 });
    const teacher = result.teachers.find((item) => item.teacherId === teacherId);

    expect(teacher?.days).toHaveLength(31);
    expect(teacher?.days[2]).toMatchObject({
      workDate: '2026-08-03',
      status: 'WORKED',
      workedMinutes: 515,
      workDeficitMinutes: 0,
    });
    expect(
      result.teachers.some((item) => item.teacherId === inactiveTeacherId),
    ).toBe(false);
  });
});
