import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEarlyDepartureRequestService } from './early-departure-requests.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseEarlyDepartureRequestRepository } from './supabase-early-departure-requests.js';

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

function jakartaWorkDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

describe('Supabase early departure request integration', () => {
  let adminClient: SupabaseClient;
  let teacherClient: SupabaseClient;
  let config: SupabaseAuthConfig;
  let teacherId: string;
  let teacherEmail: string;
  let teacherPassword: string;
  let adminId: string;
  let requestId: string | undefined;

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

    const nip = `early-${randomUUID()}`;
    teacherEmail = internalEmailForNip(nip);
    teacherPassword = `Teacher-${randomUUID()}!`;
    const { data: teacher, error: teacherError } =
      await adminClient.auth.admin.createUser({
        email: teacherEmail,
        password: teacherPassword,
        email_confirm: true,
        app_metadata: { role: 'USER' },
      });
    if (teacherError) throw teacherError;
    teacherId = teacher.user.id;

    const { data: admin, error: adminError } =
      await adminClient.auth.admin.createUser({
        email: `admin-${randomUUID()}@internal.absensi.local`,
        password: `Admin-${randomUUID()}!`,
        email_confirm: true,
        app_metadata: { role: 'SUPER_ADMIN' },
      });
    if (adminError) throw adminError;
    adminId = admin.user.id;

    const { error: profileError } = await adminClient.from('profiles').insert([
      {
        id: teacherId,
        nip,
        full_name: 'Guru Pulang Awal',
        role: 'USER',
        is_active: true,
        must_change_password: false,
      },
      {
        id: adminId,
        nip: `admin-${randomUUID()}`,
        full_name: 'Admin Pulang Awal',
        role: 'SUPER_ADMIN',
        is_active: true,
        must_change_password: false,
      },
    ]);
    if (profileError) throw profileError;
  }, 120_000);

  afterAll(async () => {
    if (!adminClient || !teacherId) return;
    runSql(`alter table public.audit_logs disable trigger audit_logs_guard_append_only;
      delete from public.audit_logs where entity_type = 'early_departure_requests' and entity_id = '${requestId ?? '00000000-0000-0000-0000-000000000000'}';
      alter table public.audit_logs enable trigger audit_logs_guard_append_only;
      delete from public.early_departure_requests where teacher_id = '${teacherId}';
      delete from public.attendance_records where teacher_id = '${teacherId}';
      delete from public.profiles where id in ('${teacherId}', '${adminId}');`);
    await adminClient.auth.admin.deleteUser(teacherId);
    await adminClient.auth.admin.deleteUser(adminId);
  });

  it('atomically records the request and actual checkout, then audits the decision', async () => {
    const serverNow = new Date();
    const workDate = jakartaWorkDate(serverNow);
    const checkInAt = new Date(serverNow.getTime() - 30 * 60_000).toISOString();
    const { error: attendanceError } = await adminClient
      .from('attendance_records')
      .insert({
        teacher_id: teacherId,
        work_date: workDate,
        check_in_at: checkInAt,
        check_in_latitude: -8.1328,
        check_in_longitude: 113.2219,
        check_in_accuracy_meters: 10,
        check_in_distance_meters: 0,
        work_start: '00:00',
        work_end: '23:59',
        checkout_close: '23:59',
        target_minutes: 515,
        arrival_late_minutes: 0,
        status: 'CHECKED_IN',
      });
    if (attendanceError) throw attendanceError;

    const repository = new SupabaseEarlyDepartureRequestRepository(config);
    const created = await repository.create(teacherId, {
      reason: 'Keperluan keluarga',
      latitude: -8.1328,
      longitude: 113.2219,
      accuracyMeters: 10,
      distanceMeters: 0,
    });
    requestId = created.id;

    const { data: attendance, error: lookupError } = await adminClient
      .from('attendance_records')
      .select('check_out_at,worked_minutes,work_deficit_minutes,status')
      .eq('teacher_id', teacherId)
      .eq('work_date', workDate)
      .single();
    if (lookupError) throw lookupError;

    expect(attendance).toMatchObject({
      check_out_at: created.requestedAt,
      status: 'COMPLETED',
    });
    expect(attendance.worked_minutes).toBeGreaterThanOrEqual(29);
    expect(attendance.work_deficit_minutes).toBe(
      Math.max(0, 515 - attendance.worked_minutes),
    );

    const service = createEarlyDepartureRequestService(
      repository,
      () => new Date(serverNow.getTime() + 60_000),
    );
    const approved = await service.approve(adminId, created.id, {
      decisionNote: 'Disetujui',
    });
    expect(approved).toMatchObject({
      status: 'APPROVED',
      decidedBy: adminId,
      decisionNote: 'Disetujui',
    });

    const adminList = await service.listAdmin({
      page: 1,
      pageSize: 10,
      status: 'APPROVED',
      workDate,
      search: 'Guru Pulang Awal',
    });
    expect(adminList.data).toEqual([
      expect.objectContaining({
        id: created.id,
        teacherFullName: 'Guru Pulang Awal',
        status: 'APPROVED',
      }),
    ]);

    const { data: audit, error: auditError } = await adminClient
      .from('audit_logs')
      .select('action,before_data,after_data')
      .eq('entity_id', created.id)
      .eq('action', 'EARLY_DEPARTURE_REQUEST_APPROVED')
      .single();
    if (auditError) throw auditError;
    expect(audit).toMatchObject({
      action: 'EARLY_DEPARTURE_REQUEST_APPROVED',
      before_data: { status: 'PENDING' },
      after_data: { status: 'APPROVED' },
    });
  });

  it('allows own reads but denies browser writes and RPC execution', async () => {
    const { error: signInError } = await teacherClient.auth.signInWithPassword({
      email: teacherEmail,
      password: teacherPassword,
    });
    if (signInError) throw signInError;

    const { data: ownRows, error: readError } = await teacherClient
      .from('early_departure_requests')
      .select('id,teacher_id,status');
    const { error: writeError } = await teacherClient
      .from('early_departure_requests')
      .update({ status: 'REJECTED' })
      .eq('id', requestId);
    const { error: rpcError } = await teacherClient.rpc(
      'create_early_departure_request',
      {
        p_teacher_id: teacherId,
        p_reason: 'Tidak boleh langsung',
        p_latitude: -8.1328,
        p_longitude: 113.2219,
        p_accuracy_meters: 10,
        p_distance_meters: 0,
      },
    );

    expect(readError).toBeNull();
    expect(ownRows).toEqual([
      expect.objectContaining({ id: requestId, teacher_id: teacherId }),
    ]);
    expect(writeError).toBeTruthy();
    expect(rpcError).toBeTruthy();
  });
});
