import { AuditLogSchema, type AuditLog, type ListAuditLogsQuery } from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { AuditLogRepository } from './audit-logs.js';
import { AppError } from './auth.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

const RowSchema = z.strictObject({
  id: z.uuid(),
  actor_id: z.uuid(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.uuid().nullable(),
  before_data: z.record(z.string(), z.unknown()).nullable(),
  after_data: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
  profiles: z.object({ nip: z.string(), full_name: z.string() }).nullable(),
});

const SECRET_KEY = /password|token|secret|cookie|authorization|signed.?url/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      SECRET_KEY.test(key) ? [] : [[key, redact(child)]],
    ),
  );
}

function toAuditLog(value: unknown): AuditLog {
  const row = RowSchema.parse(value);
  if (!row.profiles) throw new AppError(500, 'AUDIT_ACTOR_NOT_FOUND', 'Aktor audit tidak dapat dimuat');
  return AuditLogSchema.parse({
    id: row.id,
    actorId: row.actor_id,
    actorNip: row.profiles.nip,
    actorFullName: row.profiles.full_name,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeData: row.before_data ? redact(row.before_data) : null,
    afterData: row.after_data ? redact(row.after_data) : null,
    createdAt: row.created_at,
  });
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export class SupabaseAuditLogRepository implements AuditLogRepository {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async list(input: ListAuditLogsQuery) {
    const start = (input.page - 1) * input.pageSize;
    let query = this.client
      .from('audit_logs')
      .select('id,actor_id,action,entity_type,entity_id,before_data,after_data,created_at,profiles!audit_logs_actor_id_fkey(nip,full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(start, start + input.pageSize - 1);
    if (input.fromDate) query = query.gte('created_at', `${input.fromDate}T00:00:00+07:00`);
    if (input.toDate) query = query.lt('created_at', `${nextDate(input.toDate)}T00:00:00+07:00`);
    if (input.actorId) query = query.eq('actor_id', input.actorId);
    if (input.action) query = query.eq('action', input.action);
    if (input.entityType) query = query.eq('entity_type', input.entityType);
    const { data, error, count } = await query;
    if (error) throw new AppError(500, 'AUDIT_LIST_FAILED', 'Audit log tidak dapat dimuat');
    return { records: (data ?? []).map(toAuditLog), totalItems: count ?? 0 };
  }
}
