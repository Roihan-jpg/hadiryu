import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ExcelExportAudit } from './excel-export.js';
import {
  internalEmailForNip,
  type SupabaseAuthConfig,
} from './supabase-auth.js';
import { SupabaseExcelExportAuditRepository } from './supabase-excel-export.js';

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

describe('Supabase Excel export audit integration', () => {
  let client: SupabaseClient;
  let config: SupabaseAuthConfig;
  let adminId: string;

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
    const nip = `t12-admin-${randomUUID()}`;
    const created = await client.auth.admin.createUser({
      email: internalEmailForNip(nip),
      password: `User-${randomUUID()}!`,
      email_confirm: true,
      app_metadata: { role: 'SUPER_ADMIN' },
    });
    if (created.error) throw created.error;
    adminId = created.data.user.id;
    const profile = await client.from('profiles').insert({
      id: adminId,
      nip,
      full_name: 'Admin Ekspor T12',
      role: 'SUPER_ADMIN',
      is_active: true,
      must_change_password: false,
    });
    if (profile.error) throw profile.error;
  });

  afterAll(async () => {
    if (!adminId) return;
    runSql(
      `set session_replication_role = replica; delete from public.audit_logs where actor_id = '${adminId}'; delete from public.profiles where id = '${adminId}';`,
    );
    await client.auth.admin.deleteUser(adminId);
  });

  it('records generator, period, teacher count, checksum, and export time', async () => {
    const audit: ExcelExportAudit = {
      actorId: adminId,
      generator: 'exceljs@4.4.0',
      period: '2026-08',
      teacherCount: 57,
      documentStatus: 'DRAFT',
      issueCount: 3,
      templateChecksum: 'a'.repeat(64),
      exportedAt: '2030-01-02T03:04:05.000Z',
    };

    await new SupabaseExcelExportAuditRepository(config).recordExport(audit);

    const result = await client
      .from('audit_logs')
      .select('action,entity_type,entity_id,before_data,after_data')
      .eq('actor_id', adminId)
      .eq('action', 'MONTHLY_REPORT_EXPORTED')
      .single();
    if (result.error) throw result.error;
    expect(result.data).toEqual({
      action: 'MONTHLY_REPORT_EXPORTED',
      entity_type: 'monthly_report_exports',
      entity_id: null,
      before_data: null,
      after_data: {
        generator: audit.generator,
        period: audit.period,
        teacherCount: audit.teacherCount,
        documentStatus: audit.documentStatus,
        issueCount: audit.issueCount,
        templateChecksum: audit.templateChecksum,
        exportedAt: audit.exportedAt,
      },
    });
  });
});
