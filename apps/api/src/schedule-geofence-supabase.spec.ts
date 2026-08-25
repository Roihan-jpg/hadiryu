import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import { internalEmailForNip, type SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseSettingsService } from './supabase-settings.js';

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
const effectiveFrom = '2099-01-01';

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

describe('SupabaseSettingsService schedule-geofence integration', () => {
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
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    publicClient = createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    service = new SupabaseSettingsService(config);

    const nip = `t05-admin-${randomUUID()}`;
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
      full_name: 'Admin T05',
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
      delete from public.schedule_rules where effective_from = '${effectiveFrom}';
      delete from public.geofence_rules where effective_from = '${effectiveFrom}';
      update public.schedule_rules set effective_to = null where id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002');
      update public.geofence_rules set effective_to = null where id = '20000000-0000-4000-8000-000000000001';
      delete from public.profiles where id = '${adminId}';`);
    await client.auth.admin.deleteUser(adminId);
  });

  it('creates schedule versions atomically and resolves historical and effective dates', async () => {
    const created = await service.createScheduleVersion(adminId, {
      effectiveFrom,
      weekday: {
        checkInOpen: '05:30',
        workStart: '07:00',
        checkInClose: '08:00',
        checkoutOpen: '12:00',
        workEnd: '15:20',
        checkoutClose: '17:00',
        targetMinutes: 500,
      },
      saturday: {
        checkInOpen: '05:30',
        workStart: '07:00',
        checkInClose: '08:00',
        checkoutOpen: '09:30',
        workEnd: '10:20',
        checkoutClose: '12:00',
        targetMinutes: 200,
      },
    });
    const historical = await service.getSchedules('2098-12-31');
    const effective = await service.getSchedules(effectiveFrom);

    expect(created.weekday?.targetMinutes).toBe(500);
    expect(created.saturday?.targetMinutes).toBe(200);
    expect(historical.weekday?.targetMinutes).toBe(515);
    expect(historical.saturday?.targetMinutes).toBe(215);
    expect(effective.weekday?.id).toBe(created.weekday?.id);
    expect(effective.saturday?.id).toBe(created.saturday?.id);
    const { data: audits } = await client
      .from('audit_logs')
      .select('before_data,after_data')
      .eq('actor_id', adminId)
      .eq('action', 'SCHEDULE_RULE_VERSION_CREATED')
      .order('created_at');

    expect(audits).toHaveLength(2);
    expect(audits?.map((audit) => audit.before_data?.['targetMinutes']).sort()).toEqual([
      215,
      515,
    ]);
    expect(audits?.map((audit) => audit.after_data?.['targetMinutes']).sort()).toEqual([
      200,
      500,
    ]);
    await expect(
      service.createScheduleVersion(adminId, {
        effectiveFrom,
        weekday: {
          checkInOpen: '05:30',
          workStart: '07:00',
          checkInClose: '08:00',
          checkoutOpen: '12:00',
          workEnd: '15:20',
          checkoutClose: '17:00',
          targetMinutes: 500,
        },
        saturday: {
          checkInOpen: '05:30',
          workStart: '07:00',
          checkInClose: '08:00',
          checkoutOpen: '09:30',
          workEnd: '10:20',
          checkoutClose: '12:00',
          targetMinutes: 200,
        },
      }),
    ).rejects.toMatchObject({ code: 'EFFECTIVE_DATE_CONFLICT' } satisfies Partial<AppError>);
  });

  it('creates one geofence version with historical resolution and before/after audit', async () => {
    const created = await service.createGeofenceVersion(adminId, {
      effectiveFrom,
      latitude: -6.201,
      longitude: 106.817,
      radiusMeters: 125,
      maxAccuracyMeters: 40,
    });
    const historical = await service.getGeofence('2098-12-31');
    const effective = await service.getGeofence(effectiveFrom);
    const { data: audit } = await client
      .from('audit_logs')
      .select('before_data,after_data')
      .eq('actor_id', adminId)
      .eq('action', 'GEOFENCE_RULE_VERSION_CREATED')
      .single();

    expect(created.geofence?.radiusMeters).toBe(125);
    expect(historical.geofence?.radiusMeters).toBe(100);
    expect(effective.geofence?.id).toBe(created.geofence?.id);
    expect(audit?.before_data).toMatchObject({ radiusMeters: 100 });
    expect(audit?.after_data).toMatchObject({ radiusMeters: 125 });
  });

  it('rejects backdated versions and keeps mutation RPC unavailable to browser roles', async () => {
    await expect(
      service.createGeofenceVersion(adminId, {
        effectiveFrom: '2026-01-01',
        latitude: -6.2,
        longitude: 106.816666,
        radiusMeters: 100,
        maxAccuracyMeters: 50,
      }),
    ).rejects.toMatchObject({ code: 'EFFECTIVE_DATE_IN_PAST' } satisfies Partial<AppError>);

    const { error } = await publicClient.rpc('create_geofence_rule_version', {
      p_actor_id: adminId,
      p_effective_from: '2099-02-01',
      p_geofence: {
        latitude: -6.2,
        longitude: 106.816666,
        radiusMeters: 100,
        maxAccuracyMeters: 50,
      },
    });
    expect(error).toBeTruthy();
  });
});
