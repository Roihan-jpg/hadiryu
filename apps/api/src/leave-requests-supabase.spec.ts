import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLeaveRequestService } from './leave-requests.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseLeaveRequestRepository } from './supabase-leave-requests.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const supabaseCliPath = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
interface LocalStatus { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string; }
function runSupabase(args: string[]) { return spawnSync(process.execPath, [supabaseCliPath, '--workdir', repositoryRoot, ...args], { encoding: 'utf8' }); }
function status(): LocalStatus | undefined {
  const result = runSupabase(['status', '-o', 'json']);
  if (result.status !== 0) return undefined;
  try { const value = JSON.parse(result.stdout) as Partial<LocalStatus>; return value.API_URL && value.PUBLISHABLE_KEY && value.SECRET_KEY ? value as LocalStatus : undefined; } catch { return undefined; }
}
function ensureLocalSupabase(): LocalStatus {
  const current = status();
  if (current) return current;
  const started = runSupabase(['start', '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit']);
  const resolved = status();
  if (!resolved) throw new Error([started.stdout, started.stderr].filter(Boolean).join('\n'));
  return resolved;
}
function runSql(sql: string): void {
  const result = spawnSync('docker', ['exec', 'supabase_db_absensi-guru', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

describe('Supabase leave request integration', () => {
  let adminClient: SupabaseClient; let teacherClient: SupabaseClient; let config: SupabaseAuthConfig;
  let teacherId: string; let teacherEmail: string; let teacherPassword: string; let adminId: string;
  beforeAll(async () => {
    const local = ensureLocalSupabase(); config = { url: local.API_URL, publishableKey: local.PUBLISHABLE_KEY, secretKey: local.SECRET_KEY };
    adminClient = createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    teacherClient = createClient(config.url, config.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const nip = `t09-${randomUUID()}`; teacherEmail = internalEmailForNip(nip); teacherPassword = `Teacher-${randomUUID()}!`;
    const { data, error } = await adminClient.auth.admin.createUser({ email: teacherEmail, password: teacherPassword, email_confirm: true, app_metadata: { role: 'USER' } });
    if (error) throw error; teacherId = data.user.id;
    const { error: profileError } = await adminClient.from('profiles').insert({ id: teacherId, nip, full_name: 'Guru Izin', role: 'USER', is_active: true, must_change_password: false });
    if (profileError) throw profileError;
    const { data: admin, error: adminError } = await adminClient.auth.admin.createUser({
      email: `admin-${randomUUID()}@internal.absensi.local`,
      password: `Admin-${randomUUID()}!`,
      email_confirm: true,
      app_metadata: { role: 'SUPER_ADMIN' },
    });
    if (adminError) throw adminError;
    adminId = admin.user.id;
    const { error: adminProfileError } = await adminClient.from('profiles').insert({
      id: adminId, nip: `admin-${randomUUID()}`, full_name: 'Admin Izin', role: 'SUPER_ADMIN', is_active: true, must_change_password: false,
    });
    if (adminProfileError) throw adminProfileError;
  }, 120_000);
  afterAll(async () => {
    if (!adminClient || !teacherId) return;
    runSql(`alter table public.audit_logs disable trigger audit_logs_guard_append_only; delete from public.audit_logs where entity_type = 'leave_requests' and entity_id in (select id from public.leave_requests where teacher_id = '${teacherId}'); alter table public.audit_logs enable trigger audit_logs_guard_append_only; delete from public.attendance_records where teacher_id = '${teacherId}'; delete from public.leave_requests where teacher_id = '${teacherId}'; delete from public.profiles where id in ('${teacherId}', '${adminId}');`);
    await adminClient.auth.admin.deleteUser(teacherId);
    await adminClient.auth.admin.deleteUser(adminId);
  });
  it('persists a request, approves it, and records an audit decision', async () => {
    const service = createLeaveRequestService(new SupabaseLeaveRequestRepository(config), () => new Date('2099-01-05T01:00:00.000Z'));
    const created = await service.create(teacherId, { leaveDate: '2099-01-06', leaveType: 'OFFICIAL_DUTY', reason: 'Rapat dinas' });
    const approved = await service.approve(adminId, created.id, { decisionNote: 'Disetujui' });
    const { data: audit, error } = await adminClient.from('audit_logs').select('action,before_data,after_data').eq('entity_id', created.id).single();
    if (error) throw error;
    expect(approved).toMatchObject({ status: 'APPROVED', decidedBy: adminId, decisionNote: 'Disetujui' });
    expect(audit).toMatchObject({ action: 'LEAVE_APPROVED', before_data: { status: 'PENDING' }, after_data: { status: 'APPROVED' } });
  });
  it('rolls back a decision when its audit event cannot be written', async () => {
    const service = createLeaveRequestService(new SupabaseLeaveRequestRepository(config), () => new Date('2099-01-05T01:00:00.000Z'));
    const created = await service.create(teacherId, { leaveDate: '2099-01-07', leaveType: 'SICK', reason: 'Perlu istirahat' });

    runSql('revoke insert on table public.audit_logs from service_role;');
    try {
      await expect(
        service.reject(adminId, created.id, { decisionNote: 'Tidak memenuhi ketentuan' }),
      ).rejects.toMatchObject({ code: 'LEAVE_AUDIT_FAILED' });
    } finally {
      runSql('grant insert on table public.audit_logs to service_role;');
    }

    const { data, error } = await adminClient
      .from('leave_requests')
      .select('status,decided_by,decided_at')
      .eq('id', created.id)
      .single();
    if (error) throw error;
    expect(data).toEqual({ status: 'PENDING', decided_by: null, decided_at: null });
  });
  it('allows only check-in or leave approval to win when they are concurrent', async () => {
    const service = createLeaveRequestService(new SupabaseLeaveRequestRepository(config), () => new Date('2099-01-05T01:00:00.000Z'));
    const created = await service.create(teacherId, { leaveDate: '2099-01-09', leaveType: 'FAMILY', reason: 'Acara keluarga' });

    const [checkInResult, approvalResult] = await Promise.all([
      adminClient.from('attendance_records').insert({
        teacher_id: teacherId,
        work_date: '2099-01-09',
        check_in_at: '2099-01-09T00:00:00.000Z',
        check_in_latitude: -6.2,
        check_in_longitude: 106.8,
        check_in_accuracy_meters: 5,
        check_in_distance_meters: 2,
        work_start: '07:00',
        work_end: '15:35',
        checkout_close: '17:00',
        schedule_type: 'WEEKDAY',
        check_in_open_at: '2099-01-08T23:30:00.000Z',
        work_start_at: '2099-01-09T00:00:00.000Z',
        check_in_close_at: '2099-01-09T01:00:00.000Z',
        checkout_open_at: '2099-01-09T08:00:00.000Z',
        work_end_at: '2099-01-09T08:35:00.000Z',
        checkout_close_at: '2099-01-09T10:00:00.000Z',
        target_minutes: 515,
        arrival_late_minutes: 0,
        status: 'CHECKED_IN',
      }),
      adminClient.from('leave_requests').update({
        status: 'APPROVED',
        decided_by: adminId,
        decided_at: '2099-01-05T01:00:00.000Z',
      }).eq('id', created.id),
    ]);

    expect([checkInResult.error, approvalResult.error].filter((error) => error === null)).toHaveLength(1);
  });
  it('persists cancellation and exposes admin filters with teacher identity', async () => {
    const service = createLeaveRequestService(new SupabaseLeaveRequestRepository(config), () => new Date('2099-01-05T01:00:00.000Z'));
    const created = await service.create(teacherId, { leaveDate: '2099-01-10', leaveType: 'OTHER', reason: 'Keperluan pribadi' });
    await expect(service.cancel(teacherId, created.id)).resolves.toMatchObject({ status: 'CANCELLED' });

    const own = await service.listOwn(teacherId, { page: 1, pageSize: 10, status: 'CANCELLED' });
    expect(own.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'CANCELLED' }));

    const admin = await service.listAdmin({
      page: 1,
      pageSize: 10,
      status: 'CANCELLED',
      leaveDate: '2099-01-10',
      search: 'Guru Izin',
    });
    expect(admin.data).toEqual([
      expect.objectContaining({
        id: created.id,
        teacherFullName: 'Guru Izin',
        status: 'CANCELLED',
      }),
    ]);
  });
  it('persists rejection and audits the decision', async () => {
    const service = createLeaveRequestService(new SupabaseLeaveRequestRepository(config), () => new Date('2099-01-05T01:00:00.000Z'));
    const created = await service.create(teacherId, { leaveDate: '2099-01-11', leaveType: 'SICK', reason: 'Perlu istirahat' });
    await expect(service.reject(adminId, created.id, { decisionNote: 'Alasan belum cukup' })).resolves.toMatchObject({ status: 'REJECTED' });
    const { data, error } = await adminClient.from('audit_logs').select('action,after_data').eq('entity_id', created.id).single();
    if (error) throw error;
    expect(data).toMatchObject({ action: 'LEAVE_REJECTED', after_data: { status: 'REJECTED' } });
  });
  it('keeps leave writes unavailable to the browser role', async () => {
    const { error: signInError } = await teacherClient.auth.signInWithPassword({ email: teacherEmail, password: teacherPassword });
    if (signInError) throw signInError;
    const { error } = await teacherClient.from('leave_requests').insert({ teacher_id: teacherId, leave_date: '2099-01-08', leave_type: 'SICK', reason: 'Tidak boleh langsung' });
    expect(error).toBeTruthy();
  });
});
