import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAdminAttendanceService } from './admin-attendance.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseAdminAttendanceRepository } from './supabase-admin-attendance.js';

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

describe('Supabase admin attendance integration', () => {
  let adminClient: SupabaseClient;
  let browserClient: SupabaseClient;
  let config: SupabaseAuthConfig;
  let adminId: string;
  let teacherId: string;
  let attendanceId: string;
  let teacherEmail: string;
  let teacherPassword: string;

  beforeAll(async () => {
    const local = ensureLocalSupabase();
    config = {
      url: local.API_URL,
      publishableKey: local.PUBLISHABLE_KEY,
      secretKey: local.SECRET_KEY,
    };
    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    };
    adminClient = createClient(config.url, config.secretKey, options);
    browserClient = createClient(config.url, config.publishableKey, options);

    const nip = `t10-${randomUUID()}`;
    teacherEmail = internalEmailForNip(nip);
    teacherPassword = `Teacher-${randomUUID()}!`;
    const { data: teacherAuth, error: teacherAuthError } =
      await adminClient.auth.admin.createUser({
        email: teacherEmail,
        password: teacherPassword,
        email_confirm: true,
        app_metadata: { role: 'USER' },
      });
    if (teacherAuthError) throw teacherAuthError;
    teacherId = teacherAuth.user.id;

    const { data: adminAuth, error: adminAuthError } =
      await adminClient.auth.admin.createUser({
        email: `admin-${randomUUID()}@internal.absensi.local`,
        password: `Admin-${randomUUID()}!`,
        email_confirm: true,
        app_metadata: { role: 'SUPER_ADMIN' },
      });
    if (adminAuthError) throw adminAuthError;
    adminId = adminAuth.user.id;

    const { error: profileError } = await adminClient.from('profiles').insert([
      {
        id: teacherId,
        nip,
        full_name: 'Guru Monitoring',
        role: 'USER',
        is_active: true,
        must_change_password: false,
      },
      {
        id: adminId,
        nip: `admin-${randomUUID()}`,
        full_name: 'Admin Monitoring',
        role: 'SUPER_ADMIN',
        is_active: true,
        must_change_password: false,
      },
    ]);
    if (profileError) throw profileError;

    const { data: attendance, error: attendanceError } = await adminClient
      .from('attendance_records')
      .insert({
        teacher_id: teacherId,
        work_date: '2099-01-05',
        check_in_at: '2099-01-05T00:03:00.000Z',
        check_in_latitude: -6.2,
        check_in_longitude: 106.816666,
        check_in_accuracy_meters: 5,
        check_in_distance_meters: 2,
        work_start: '07:00',
        work_end: '15:35',
        checkout_close: '17:00',
        schedule_type: 'WEEKDAY',
        check_in_open_at: '2099-01-04T23:30:00.000Z',
        work_start_at: '2099-01-05T00:00:00.000Z',
        check_in_close_at: '2099-01-05T01:00:00.000Z',
        checkout_open_at: '2099-01-05T08:00:00.000Z',
        work_end_at: '2099-01-05T08:35:00.000Z',
        checkout_close_at: '2099-01-05T10:00:00.000Z',
        target_minutes: 515,
        arrival_late_minutes: 3,
        status: 'CHECKED_IN',
      })
      .select('id')
      .single();
    if (attendanceError) throw attendanceError;
    attendanceId = attendance.id;
  }, 120_000);

  afterAll(async () => {
    if (!adminClient || !teacherId) return;
    runSql(`
      alter table public.audit_logs disable trigger audit_logs_guard_append_only;
      alter table public.attendance_admin_notes disable trigger attendance_admin_notes_guard_append_only;
      delete from public.audit_logs where entity_type = 'attendance_admin_notes'
        and after_data ->> 'attendanceId' = '${attendanceId}';
      delete from public.attendance_admin_notes where attendance_id = '${attendanceId}';
      alter table public.attendance_admin_notes enable trigger attendance_admin_notes_guard_append_only;
      alter table public.audit_logs enable trigger audit_logs_guard_append_only;
      delete from public.attendance_records where teacher_id = '${teacherId}';
      delete from public.profiles where id in ('${teacherId}', '${adminId}');
    `);
    await adminClient.auth.admin.deleteUser(teacherId);
    await adminClient.auth.admin.deleteUser(adminId);
  });

  it('loads only the requested day and derives monitoring identity', async () => {
    const service = createAdminAttendanceService(
      new SupabaseAdminAttendanceRepository(config),
      () => new Date('2099-01-05T01:00:00.000Z'),
    );

    const result = await service.list({
      page: 1,
      pageSize: 20,
      workDate: '2099-01-05',
      search: 'Guru Monitoring',
    });

    expect(result.data).toEqual([
      expect.objectContaining({
        teacherId,
        teacherFullName: 'Guru Monitoring',
        attendanceId,
        status: 'LATE',
      }),
    ]);
    expect(result.summary).toMatchObject({ late: 1, total: 1 });
  });

  it('appends and audits a note without changing attendance values', async () => {
    const repository = new SupabaseAdminAttendanceRepository(config);
    const before = await adminClient
      .from('attendance_records')
      .select('check_in_at,check_out_at,worked_minutes,work_deficit_minutes,status')
      .eq('id', attendanceId)
      .single();
    if (before.error) throw before.error;

    const note = await createAdminAttendanceService(repository).addNote(
      adminId,
      attendanceId,
      { note: 'Dokumen pendukung telah diperiksa' },
    );
    const after = await adminClient
      .from('attendance_records')
      .select('check_in_at,check_out_at,worked_minutes,work_deficit_minutes,status')
      .eq('id', attendanceId)
      .single();
    if (after.error) throw after.error;
    const audit = await adminClient
      .from('audit_logs')
      .select('action,entity_id,after_data')
      .eq('entity_id', note.id)
      .single();
    if (audit.error) throw audit.error;

    expect(after.data).toEqual(before.data);
    expect(audit.data).toMatchObject({
      action: 'ATTENDANCE_ADMIN_NOTE_CREATED',
      entity_id: note.id,
      after_data: {
        attendanceId,
        note: 'Dokumen pendukung telah diperiksa',
      },
    });
  });

  it('rolls back a note when its audit event cannot be written', async () => {
    const repository = new SupabaseAdminAttendanceRepository(config);
    runSql('revoke insert on table public.audit_logs from service_role;');
    try {
      await expect(
        repository.createNote(attendanceId, adminId, {
          note: 'Catatan tanpa audit',
        }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_NOTE_AUDIT_FAILED' });
    } finally {
      runSql('grant insert on table public.audit_logs to service_role;');
    }

    const { count, error } = await adminClient
      .from('attendance_admin_notes')
      .select('id', { count: 'exact', head: true })
      .eq('attendance_id', attendanceId)
      .eq('note', 'Catatan tanpa audit');
    if (error) throw error;
    expect(count).toBe(0);
  });

  it('keeps note writes unavailable to browser roles and existing notes immutable', async () => {
    const { error: signInError } = await browserClient.auth.signInWithPassword({
      email: teacherEmail,
      password: teacherPassword,
    });
    if (signInError) throw signInError;
    const browserWrite = await browserClient.from('attendance_admin_notes').insert({
      attendance_id: attendanceId,
      note: 'Tidak boleh langsung',
      created_by: teacherId,
    });
    const { data: existing, error: existingError } = await adminClient
      .from('attendance_admin_notes')
      .select('id')
      .eq('attendance_id', attendanceId)
      .limit(1)
      .single();
    if (existingError) throw existingError;
    const update = await adminClient
      .from('attendance_admin_notes')
      .update({ note: 'Diubah' })
      .eq('id', existing.id);
    const deletion = await adminClient
      .from('attendance_admin_notes')
      .delete()
      .eq('id', existing.id);

    expect(browserWrite.error).toBeTruthy();
    expect(update.error).toBeTruthy();
    expect(deletion.error).toBeTruthy();
  });
});
