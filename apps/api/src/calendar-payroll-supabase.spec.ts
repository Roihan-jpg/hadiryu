import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import { calculatePerformancePay } from './calendar-payroll.js';
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
const payrollDate = '2099-01-01';

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

describe('SupabaseSettingsService calendar-payroll integration', () => {
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
      delete from public.payroll_rules where effective_from = '${payrollDate}';
      update public.payroll_rules set effective_to = null where id = '30000000-0000-4000-8000-000000000001';
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

  it('versions payroll by month without changing the historical rule or restricting negative pay', async () => {
    const created = await service.createPayrollVersion(adminId, {
      effectiveFrom: payrollDate,
      basePerformancePay: 1_000_000,
      deductionRatePerMinute: 2500,
    });
    const historical = await service.getPayroll('2098-12-01');
    const effective = await service.getPayroll(payrollDate);
    const calculation = calculatePerformancePay({
      totalWorkDeficitMinutes: 500,
      payrollRule: created.payrollRule!,
    });
    const { data: audit } = await client
      .from('audit_logs')
      .select('before_data,after_data')
      .eq('actor_id', adminId)
      .eq('action', 'PAYROLL_RULE_VERSION_CREATED')
      .single();

    expect(historical.payrollRule?.basePerformancePay).toBe(0);
    expect(effective.payrollRule?.id).toBe(created.payrollRule?.id);
    expect(calculation.finalPerformancePay).toBe(-250_000);
    expect(audit?.before_data).toMatchObject({ basePerformancePay: 0 });
    expect(audit?.after_data).toMatchObject({ basePerformancePay: 1_000_000 });
  });

  it('rejects calendar history and keeps configuration mutations unavailable to browser roles', async () => {
    await expect(
      service.createCalendarException(adminId, {
        workDate: '2026-01-01',
        exceptionType: 'HOLIDAY',
        name: 'Libur historis',
        scheduleType: null,
      }),
    ).rejects.toMatchObject({ code: 'CALENDAR_DATE_IN_PAST' } satisfies Partial<AppError>);
    const { error } = await publicClient.rpc('create_payroll_rule_version', {
      p_actor_id: adminId,
      p_effective_from: '2099-02-01',
      p_base_performance_pay: 1,
      p_deduction_rate_per_minute: 1,
    });
    expect(error).toBeTruthy();
  });
});
