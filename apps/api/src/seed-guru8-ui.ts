import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  GURU8_UI_FIXTURE_START,
  buildGuru8UiFixture,
  type FixtureEarlyDepartureStatus,
  type Guru8UiFixture,
  type Guru8UiFixtureTarget,
  isGuru8UiFixtureTargetUrl,
} from './guru8-ui-fixture.js';
import { hashPassword, loadSupabaseAuthConfig } from './supabase-auth.js';

const GURU8_NIP = 'guru8';
const GURU8_NAME = 'Guru Uji 8';
const FIXTURE_ADMIN_ID = '80000000-0000-4000-8000-000000000008';
const FIXTURE_ADMIN_NIP = 'fixture-admin-guru8';

interface ScheduleRow {
  schedule_type: 'WEEKDAY' | 'SATURDAY';
  check_in_open: string;
  work_start: string;
  check_in_close: string;
  checkout_open: string;
  work_end: string;
  checkout_close: string;
  target_minutes: number;
  effective_from: string;
  effective_to: string | null;
}

interface FixtureTable {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
}

interface FixtureDatabase {
  public: {
    Tables: Record<string, FixtureTable>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

type FixtureClient = SupabaseClient<FixtureDatabase>;

function failIfError(error: { message: string } | null, message: string): void {
  if (error) throw new Error(`${message}: ${error.message}`);
}

function jakartaTimestamp(workDate: string, time: string): string {
  return `${workDate}T${time.slice(0, 5)}:00+07:00`;
}

function toMinutes(time: string): number {
  const [hour, minute] = time.slice(0, 5).split(':').map(Number);
  return hour! * 60 + minute!;
}

function timeFromMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function scheduleFor(workDate: string, rows: ScheduleRow[]): ScheduleRow {
  const day = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
  const scheduleType = day === 6 ? 'SATURDAY' : 'WEEKDAY';
  const schedule = rows.find((row) =>
    row.schedule_type === scheduleType &&
    row.effective_from <= workDate &&
    (row.effective_to === null || row.effective_to >= workDate),
  );
  if (!schedule) throw new Error(`Jadwal ${scheduleType} tidak tersedia untuk ${workDate}`);
  return schedule;
}

function earlyCheckoutTime(schedule: ScheduleRow, status: FixtureEarlyDepartureStatus | null): string {
  if (!status) return schedule.work_end;
  return timeFromMinutes(toMinutes(schedule.work_end) - 60);
}

async function ensureFixtureAdmin(client: FixtureClient): Promise<void> {
  const { error } = await client.from('profiles').upsert({
    id: FIXTURE_ADMIN_ID,
    nip: FIXTURE_ADMIN_NIP,
    full_name: 'Admin Fixture Guru 8',
    whatsapp_number: null,
    role: 'SUPER_ADMIN',
    is_active: true,
    must_change_password: false,
    temporary_password_expires_at: null,
  }, { onConflict: 'id' });
  failIfError(error, 'Profil admin fixture tidak dapat disiapkan');
}

async function ensureReportingStart(
  client: FixtureClient,
): Promise<void> {
  const { data, error } = await client
    .from('reporting_settings')
    .select('operational_start_date')
    .eq('singleton', true)
    .maybeSingle();
  failIfError(error, 'Pengaturan laporan tidak dapat dimuat');
  const operationalStartDate = data?.['operational_start_date'];
  if (data && operationalStartDate !== GURU8_UI_FIXTURE_START) {
    throw new Error('Pengaturan laporan sudah dipakai dan tidak boleh diubah oleh fixture.');
  }
  if (data) return;
  const { error: insertError } = await client.from('reporting_settings').insert({
    singleton: true,
    operational_start_date: GURU8_UI_FIXTURE_START,
  });
  failIfError(insertError, 'Pengaturan laporan fixture tidak dapat disimpan');
}

async function ensureGuru8(
  client: FixtureClient,
  password: string,
): Promise<string> {
  const { data: existing, error: findError } = await client
    .from('profiles')
    .select('id')
    .eq('nip', GURU8_NIP)
    .maybeSingle();
  failIfError(findError, 'Profil guru8 tidak dapat dimuat');
  const existingId = existing?.['id'];
  const profileId = typeof existingId === 'string' ? existingId : randomUUID();
  const profile = {
    id: profileId,
    nip: GURU8_NIP,
    full_name: GURU8_NAME,
    whatsapp_number: null,
    role: 'USER',
    is_active: true,
    must_change_password: false,
    temporary_password_expires_at: null,
    profile_photo_storage_path: null,
    profile_photo_mime_type: null,
    profile_photo_size_bytes: null,
    profile_photo_updated_at: null,
    created_at: jakartaTimestamp(GURU8_UI_FIXTURE_START, '00:00'),
  };
  const { error: profileError } = existing
    ? await client.from('profiles').update(profile).eq('id', profileId)
    : await client.from('profiles').insert(profile);
  failIfError(profileError, 'Profil guru8 tidak dapat disimpan');

  const passwordHash = await hashPassword(password);
  const { error: accountError } = await client.from('app_accounts').upsert({
    profile_id: profileId,
    password_hash: passwordHash,
    password_changed_at: new Date().toISOString(),
    failed_login_attempts: 0,
    locked_until: null,
  }, { onConflict: 'profile_id' });
  failIfError(accountError, 'Akun guru8 tidak dapat disiapkan');
  const { error: sessionError } = await client
    .from('app_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('revoked_at', null);
  failIfError(sessionError, 'Sesi guru8 tidak dapat dicabut');
  return profileId;
}

function assertHostedProjectLink(supabaseUrl: string): void {
  const linkedProjectRef = readFileSync(
    resolve('supabase/.temp/project-ref'),
    'utf8',
  ).trim();
  const projectRef = new URL(supabaseUrl).hostname.replace(/\.supabase\.co$/, '');
  if (linkedProjectRef !== projectRef) {
    throw new Error('Project Supabase hosted yang ter-link bukan target fixture guru8.');
  }
}

async function hasFixtureData(
  client: FixtureClient,
  teacherId: string,
  fixture: Guru8UiFixture,
): Promise<boolean> {
  const checks = await Promise.all([
    client.from('early_departure_requests').select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .gte('work_date', fixture.startDate)
      .lte('work_date', fixture.endDate),
    client.from('leave_requests').select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .gte('leave_date', fixture.startDate)
      .lte('leave_date', fixture.endDate),
    client.from('attendance_records').select('id', { count: 'exact', head: true })
      .eq('teacher_id', teacherId)
      .gte('work_date', fixture.startDate)
      .lte('work_date', fixture.endDate),
  ]);
  for (const result of checks) failIfError(result.error, 'Data fixture tidak dapat diperiksa');
  return checks.some((result) => (result.count ?? 0) > 0);
}

async function clearFixtureRange(
  client: FixtureClient,
  teacherId: string,
  target: Guru8UiFixtureTarget,
  fixture: Guru8UiFixture,
  supabaseUrl: string,
): Promise<void> {
  const sql = `
    delete from public.early_departure_requests
    where teacher_id = '${teacherId}'
      and work_date between '${fixture.startDate}' and '${fixture.endDate}';
    delete from public.leave_requests
    where teacher_id = '${teacherId}'
      and leave_date between '${fixture.startDate}' and '${fixture.endDate}';
    delete from public.attendance_records
    where teacher_id = '${teacherId}'
      and work_date between '${fixture.startDate}' and '${fixture.endDate}';
  `;
  try {
    if (target === 'local') {
      execFileSync('docker', [
        'exec', 'supabase_db_absensi-guru', 'psql', '-U', 'postgres', '-d', 'postgres',
        '-v', 'ON_ERROR_STOP=1', '-c', sql,
      ], { stdio: 'pipe' });
      return;
    }
    if (!await hasFixtureData(client, teacherId, fixture)) return;
    assertHostedProjectLink(supabaseUrl);
    execFileSync(process.execPath, [
      resolve('node_modules/supabase/dist/supabase.js'),
      'db', 'query', '--linked', sql,
    ], { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Data fixture ${target} tidak dapat dibersihkan.`, { cause: error });
  }
}

export async function seedGuru8UiFixture(
  environment: Record<string, string | undefined>,
  target: Guru8UiFixtureTarget = 'local',
): Promise<void> {
  const password = environment['GURU8_UI_PASSWORD'];
  if (!password) throw new Error('GURU8_UI_PASSWORD wajib diisi saat menjalankan fixture.');
  const config = loadSupabaseAuthConfig(environment);
  if (!isGuru8UiFixtureTargetUrl(target, config.url)) {
    throw new Error(`URL Supabase tidak sesuai untuk fixture guru8 target ${target}.`);
  }
  const client = createClient<FixtureDatabase>(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const fixture = buildGuru8UiFixture(target);
  const { data: scheduleRows, error: scheduleError } = await client
    .from('schedule_rules')
    .select('schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to');
  failIfError(scheduleError, 'Jadwal fixture tidak dapat dimuat');
  const schedules = (scheduleRows ?? []) as unknown as ScheduleRow[];
  for (const attendance of fixture.attendances) {
    scheduleFor(attendance.workDate, schedules);
  }

  await ensureFixtureAdmin(client);
  await ensureReportingStart(client);
  const teacherId = await ensureGuru8(client, password);
  await clearFixtureRange(client, teacherId, target, fixture, config.url);

  const leaveRows = fixture.leaves.map((leave) => ({
    teacher_id: teacherId,
    leave_date: leave.workDate,
    leave_type: leave.leaveType,
    reason: `Fixture UI guru8: ${leave.leaveType}`,
    status: leave.status,
    decision_note: leave.status === 'APPROVED' || leave.status === 'REJECTED' ? 'Keputusan fixture UI.' : null,
    decided_by: leave.status === 'APPROVED' || leave.status === 'REJECTED' ? FIXTURE_ADMIN_ID : null,
    decided_at: leave.status === 'APPROVED' || leave.status === 'REJECTED'
      ? jakartaTimestamp(leave.workDate, '16:00')
      : null,
    created_at: jakartaTimestamp(leave.workDate, '06:00'),
  }));
  const { error: leaveInsertError } = await client.from('leave_requests').insert(leaveRows);
  failIfError(leaveInsertError, 'Izin fixture tidak dapat disimpan');

  const attendanceRows = fixture.attendances.map((record) => {
    const schedule = scheduleFor(record.workDate, schedules);
    const checkInTime = timeFromMinutes(toMinutes(schedule.work_start) + record.arrivalLateMinutes);
    const checkOutTime = earlyCheckoutTime(schedule, record.earlyDepartureStatus);
    const workedMinutes = toMinutes(checkOutTime) - toMinutes(checkInTime);
    return {
      teacher_id: teacherId,
      work_date: record.workDate,
      check_in_at: jakartaTimestamp(record.workDate, checkInTime),
      check_in_latitude: -6.2,
      check_in_longitude: 106.816666,
      check_in_accuracy_meters: 10,
      check_in_distance_meters: 0,
      check_in_boundary_clearance_meters: 100,
      check_out_at: jakartaTimestamp(record.workDate, checkOutTime),
      check_out_latitude: -6.2,
      check_out_longitude: 106.816666,
      check_out_accuracy_meters: 10,
      check_out_distance_meters: 0,
      check_out_boundary_clearance_meters: 100,
      work_start: schedule.work_start,
      work_end: schedule.work_end,
      checkout_close: schedule.checkout_close,
      target_minutes: schedule.target_minutes,
      worked_minutes: workedMinutes,
      arrival_late_minutes: record.arrivalLateMinutes,
      work_deficit_minutes: Math.max(0, schedule.target_minutes - workedMinutes),
      status: 'COMPLETED',
      schedule_type: schedule.schedule_type,
      check_in_open_at: jakartaTimestamp(record.workDate, schedule.check_in_open),
      work_start_at: jakartaTimestamp(record.workDate, schedule.work_start),
      check_in_close_at: jakartaTimestamp(record.workDate, schedule.check_in_close),
      checkout_open_at: jakartaTimestamp(record.workDate, schedule.checkout_open),
      work_end_at: jakartaTimestamp(record.workDate, schedule.work_end),
      checkout_close_at: jakartaTimestamp(record.workDate, schedule.checkout_close),
    };
  });
  const { data: attendanceRowsWithId, error: attendanceInsertError } = await client
    .from('attendance_records')
    .insert(attendanceRows)
    .select('id,work_date');
  failIfError(attendanceInsertError, 'Absensi fixture tidak dapat disimpan');
  const attendanceIdByDate = new Map((attendanceRowsWithId ?? []).flatMap((row) => {
    const workDate = row['work_date'];
    const id = row['id'];
    return typeof workDate === 'string' && typeof id === 'string' ? [[workDate, id] as const] : [];
  }));

  const earlyRows = fixture.earlyDepartures.map((request) => {
    const attendanceId = attendanceIdByDate.get(request.workDate);
    if (!attendanceId) throw new Error(`Absensi pulang awal ${request.workDate} tidak ditemukan.`);
    return {
      attendance_id: attendanceId,
      teacher_id: teacherId,
      work_date: request.workDate,
      requested_at: jakartaTimestamp(request.workDate, '14:35'),
      reason: 'Fixture UI pulang awal.',
      latitude: -6.2,
      longitude: 106.816666,
      accuracy_meters: 10,
      distance_meters: 0,
      status: request.status,
      decision_note: request.status === 'PENDING' ? null : 'Keputusan fixture UI.',
      decided_by: request.status === 'PENDING' ? null : FIXTURE_ADMIN_ID,
      decided_at: request.status === 'PENDING' ? null : jakartaTimestamp(request.workDate, '16:00'),
      created_at: jakartaTimestamp(request.workDate, '14:35'),
    };
  });
  const { error: earlyInsertError } = await client.from('early_departure_requests').insert(earlyRows);
  failIfError(earlyInsertError, 'Permohonan pulang awal fixture tidak dapat disimpan');
  process.stdout.write(
    `Fixture UI ${target} guru8 siap: ${fixture.attendances.length} absensi, ${fixture.leaves.length} izin, dan ${fixture.earlyDepartures.length} permohonan pulang awal.\n`,
  );
}

const target = process.env['GURU8_UI_FIXTURE_TARGET'] ?? 'local';
if (target !== 'local' && target !== 'hosted') {
  throw new Error('GURU8_UI_FIXTURE_TARGET harus local atau hosted.');
}
await seedGuru8UiFixture(process.env, target);
