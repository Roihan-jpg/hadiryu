import { sanitizeLogValue, validateKey, validateSupabaseUrl } from './core.mjs';
import { validateDatabaseSchema } from './database.mjs';

async function safeResponseReason(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return '';
  try {
    const body = await response.json();
    const reason = [body?.message, body?.hint].filter((value) => typeof value === 'string').join(' ');
    return sanitizeLogValue(reason).replace(/[\r\n]+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}

async function assertApiKey(url, path, key, label, fetchImpl) {
  const response = await fetchImpl(`${url}${path}`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const reason = await safeResponseReason(response);
    const detail = reason ? ` Alasan Supabase: ${reason}` : '';
    throw new Error(`${label} ditolak oleh Supabase API (HTTP ${response.status}).${detail}`);
  }
}

export function assertMatchingProject(supabaseUrl, databaseUrl) {
  const apiHost = new URL(supabaseUrl).hostname;
  const projectRef = apiHost.endsWith('.supabase.co')
    ? apiHost.slice(0, -'.supabase.co'.length)
    : null;
  if (!projectRef) return;
  const database = new URL(databaseUrl);
  const directMatch = database.hostname === `db.${projectRef}.supabase.co`;
  const poolerMatch = database.username.endsWith(`.${projectRef}`);
  if (!directMatch && !poolerMatch) {
    throw new Error('Supabase URL dan database connection string tampaknya berasal dari project berbeda.');
  }
}

export async function validateCredentials(input, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = validateSupabaseUrl(input.supabaseUrl);
  const publishableKey = validateKey(input.publishableKey, 'Publishable key');
  const secretKey = validateKey(input.secretKey, 'Secret key');
  assertMatchingProject(url, input.databaseUrl);
  await assertApiKey(url, '/auth/v1/settings', publishableKey, 'Publishable key', fetchImpl);
  await assertApiKey(url, '/rest/v1/', secretKey, 'Secret key', fetchImpl);
}

export async function validateInstallation(client, input) {
  await validateDatabaseSchema(client);
  const accounts = await client.query(`
    select p.nip, p.role, p.is_active, a.profile_id is not null as has_account
    from public.profiles p
    left join public.app_accounts a on a.profile_id = p.id
    where lower(p.nip) in (lower($1), lower($2))
  `, [input.adminNip, input.teacherNip]);
  const byNip = new Map(accounts.rows.map((row) => [row.nip.toLowerCase(), row]));
  const admin = byNip.get(input.adminNip.toLowerCase());
  const teacher = byNip.get(input.teacherNip.toLowerCase());
  if (!admin || admin.role !== 'SUPER_ADMIN' || !admin.is_active || !admin.has_account) {
    throw new Error('Akun SuperAdmin awal tidak valid.');
  }
  if (!teacher || teacher.role !== 'USER' || !teacher.is_active || !teacher.has_account) {
    throw new Error('Akun Guru demo tidak valid.');
  }
}
