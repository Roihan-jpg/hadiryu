import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseSettingsService } from './supabase-settings.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const supabaseCliPath = path.join(repositoryRoot, 'node_modules', 'supabase', 'dist', 'supabase.js');
const futureDate = '2099-01-01';

function jakartaDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

const today = jakartaDate();
const yesterday = jakartaDate(-1);

interface LocalStatus {
  API_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
}

function runSupabase(args: string[]) {
  return spawnSync(process.execPath, [supabaseCliPath, '--workdir', repositoryRoot, ...args], { encoding: 'utf8' });
}

function readStatus(): LocalStatus | undefined {
  const result = runSupabase(['status', '-o', 'json']);
  if (result.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as Partial<LocalStatus>;
    return parsed.API_URL && parsed.PUBLISHABLE_KEY && parsed.SECRET_KEY ? (parsed as LocalStatus) : undefined;
  } catch {
    return undefined;
  }
}

function ensureLocalAuth(): LocalStatus {
  const current = readStatus();
  if (current) return current;
  runSupabase(['stop']);
  const started = runSupabase(['start', '--exclude', 'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit']);
  const status = readStatus();
  if (!status) throw new Error([started.stdout, started.stderr].filter(Boolean).join('\n'));
  return status;
}

function runSql(sql: string): void {
  const result = spawnSync('docker', ['exec', 'supabase_db_absensi-guru', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

const weekday = {
  checkInOpen: '05:30', workStart: '07:00', checkInClose: '08:00', checkoutOpen: '12:00',
  workEnd: '15:20', checkoutClose: '17:00', targetMinutes: 500,
};
const saturday = {
  checkInOpen: '05:30', workStart: '07:00', checkInClose: '08:00', checkoutOpen: '09:30',
  workEnd: '10:20', checkoutClose: '12:00', targetMinutes: 200,
};

describe('SupabaseSettingsService schedule-geofence integration', () => {
  let client: SupabaseClient;
  let publicClient: SupabaseClient;
  let service: SupabaseSettingsService;
  let adminId: string;

  beforeAll(async () => {
    const status = ensureLocalAuth();
    const config: SupabaseAuthConfig = { url: status.API_URL, publishableKey: status.PUBLISHABLE_KEY, secretKey: status.SECRET_KEY };
    client = createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    publicClient = createClient(config.url, config.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    service = new SupabaseSettingsService(config);
    const nip = `t05-admin-${randomUUID()}`;
    const { data, error } = await client.auth.admin.createUser({
      email: internalEmailForNip(nip), password: `Admin-${randomUUID()}!`, email_confirm: true,
      app_metadata: { role: 'SUPER_ADMIN' },
    });
    if (error) throw error;
    adminId = data.user.id;
    const { error: profileError } = await client.from('profiles').insert({
      id: adminId, nip, full_name: 'Admin T05', role: 'SUPER_ADMIN', is_active: true, must_change_password: false,
    });
    if (profileError) throw profileError;
    runSql('delete from public.reporting_settings;');
  }, 120_000);

  afterAll(async () => {
    if (!client || !adminId) return;
    runSql(`set session_replication_role = replica;
      delete from public.audit_logs where actor_id = '${adminId}';
      delete from public.schedule_rules where effective_from in ('${today}', '${futureDate}');
      delete from public.geofence_rules where effective_from in ('${today}', '${futureDate}');
      delete from public.reporting_settings;
      update public.schedule_rules set effective_to = null where id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
      update public.geofence_rules set effective_to = null where id = '20000000-0000-4000-8000-000000000001';
      delete from public.profiles where id = '${adminId}';`);
    await client.auth.admin.deleteUser(adminId);
  });

  it('uses the Jakarta server date, updates the same day, and preserves yesterday', async () => {
    const first = await service.saveSchedules(adminId, { weekday, saturday });
    const historical = await service.getSchedules(yesterday);
    const second = await service.saveSchedules(adminId, {
      weekday: { ...weekday, targetMinutes: 510 }, saturday: { ...saturday, targetMinutes: 210 },
    });
    expect(first.effectiveOn).toBe(today);
    expect(second.effectiveOn).toBe(today);
    expect(second.weekday?.id).toBe(first.weekday?.id);
    expect(second.saturday?.id).toBe(first.saturday?.id);
    expect(second.weekday?.targetMinutes).toBe(510);
    expect(historical.weekday?.targetMinutes).toBe(515);
    expect(historical.saturday?.targetMinutes).toBe(215);
    const { count } = await client.from('schedule_rules').select('*', { count: 'exact', head: true }).eq('effective_from', today);
    expect(count).toBe(2);
  });

  it('stores the report operational start separately and audits changes', async () => {
    const initial = await service.getReportingSettings();
    expect(initial).toEqual({ operationalStartDate: null, locked: false });

    const saved = await service.saveReportingSettings(adminId, {
      operationalStartDate: futureDate,
    });
    expect(saved).toEqual({ operationalStartDate: futureDate, locked: false });
    const { count } = await client
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('actor_id', adminId)
      .eq('action', 'REPORTING_SETTINGS_SAVED');
    expect(count).toBe(1);
  });

  it('cancels and audits pending future schedule versions', async () => {
    runSql(`set session_replication_role = replica;
      update public.schedule_rules set effective_to = '${futureDate}'::date - 1 where effective_from = '${today}';
      insert into public.schedule_rules (schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from)
      values ('WEEKDAY','05:30','07:00','08:00','12:00','15:00','17:00',480,'${futureDate}'),
             ('SATURDAY','05:30','07:00','08:00','09:30','10:00','12:00',180,'${futureDate}');`);
    const saved = await service.saveSchedules(adminId, { weekday, saturday });
    const { count } = await client.from('schedule_rules').select('*', { count: 'exact', head: true }).eq('effective_from', futureDate);
    const { data: audits } = await client.from('audit_logs').select('before_data,after_data').eq('actor_id', adminId).eq('action', 'SCHEDULE_FUTURE_VERSION_CANCELLED');
    expect(saved.weekday?.effectiveTo).toBeNull();
    expect(count).toBe(0);
    expect(audits).toHaveLength(2);
    expect(
      audits?.map((audit) => audit.before_data?.['targetMinutes']).sort(),
    ).toEqual([180, 480]);
    expect(audits?.every((audit) => audit.after_data === null)).toBe(true);
  });

  it('updates todays geofence, preserves history, and cancels future versions', async () => {
    const firstVertices = [
      { latitude: -6.2013, longitude: 106.8167 },
      { latitude: -6.2013, longitude: 106.8173 },
      { latitude: -6.2007, longitude: 106.8173 },
      { latitude: -6.2007, longitude: 106.8167 },
    ];
    const secondVertices = firstVertices.map((vertex) => ({
      latitude: vertex.latitude - 0.001,
      longitude: vertex.longitude + 0.001,
    }));
    const first = await service.saveGeofence(adminId, {
      shape: 'POLYGON', vertices: firstVertices, maxAccuracyMeters: 15,
    });
    const historical = await service.getGeofence(yesterday);
    const second = await service.saveGeofence(adminId, {
      shape: 'POLYGON', vertices: secondVertices, maxAccuracyMeters: 15,
    });
    expect(second.geofence?.id).toBe(first.geofence?.id);
    expect(second.effectiveOn).toBe(today);
    expect(historical.geofence).toMatchObject({ shape: 'CIRCLE', radiusMeters: 100 });
    runSql(`set session_replication_role = replica;
      update public.geofence_rules set effective_to = '${futureDate}'::date - 1 where effective_from = '${today}';
      insert into public.geofence_rules (latitude,longitude,radius_meters,max_accuracy_meters,effective_from)
      values (-6.3,106.9,200,50,'${futureDate}');`);
    const saved = await service.saveGeofence(adminId, {
      shape: 'POLYGON', vertices: firstVertices, maxAccuracyMeters: 15,
    });
    const { count } = await client.from('geofence_rules').select('*', { count: 'exact', head: true }).eq('effective_from', futureDate);
    const { count: auditCount } = await client.from('audit_logs').select('*', { count: 'exact', head: true }).eq('actor_id', adminId).eq('action', 'GEOFENCE_FUTURE_VERSION_CANCELLED');
    expect(saved.geofence?.effectiveTo).toBeNull();
    expect(count).toBe(0);
    expect(auditCount).toBe(1);
  });

  it('keeps mutation RPCs unavailable to browser roles', async () => {
    const { error: scheduleError } = await publicClient.rpc('save_schedule_settings', { p_actor_id: adminId, p_weekday: weekday, p_saturday: saturday });
    const { error: geofenceError } = await publicClient.rpc('save_geofence_settings', {
      p_actor_id: adminId,
      p_geofence: {
        shape: 'POLYGON',
        vertices: [
          { latitude: -6.2003, longitude: 106.8163 },
          { latitude: -6.2003, longitude: 106.8170 },
          { latitude: -6.1997, longitude: 106.8170 },
        ],
        maxAccuracyMeters: 15,
      },
    });
    const { error: reportingError } = await publicClient.rpc('save_reporting_settings', {
      p_actor_id: adminId,
      p_operational_start_date: futureDate,
    });
    expect(scheduleError).toBeTruthy();
    expect(geofenceError).toBeTruthy();
    expect(reportingError).toBeTruthy();
  });
});
