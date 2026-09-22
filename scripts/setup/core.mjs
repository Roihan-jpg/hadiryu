import { createHash, randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/;
const NIP_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function assertSupportedNodeVersion(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number);
  const supported =
    (major === 22 && (minor > 22 || (minor === 22 && patch >= 3))) ||
    (major === 24 && (minor > 15 || (minor === 15 && patch >= 0))) ||
    major >= 26;
  if (!supported) {
    throw new Error(
      `Node.js ${version} tidak didukung. Gunakan Node.js 22.22.3+, 24.15.0+, atau 26+.`,
    );
  }
}

export function assertSupportedNpmUserAgent(userAgent) {
  const npmVersion = String(userAgent ?? '').match(/(?:^|\s)npm\/([^\s]+)/)?.[1];
  const npmMajor = Number(npmVersion?.split('.')[0]);
  if (!Number.isInteger(npmMajor) || npmMajor < 11) {
    throw new Error(
      `Versi npm tidak didukung atau tidak terdeteksi (${npmVersion ?? 'unknown'}). Jalankan melalui npm 11 atau lebih baru.`,
    );
  }
  return npmVersion;
}

export function validateNip(value, label = 'NIP') {
  const normalized = String(value ?? '').trim();
  if (!NIP_PATTERN.test(normalized)) {
    throw new Error(
      `${label} wajib 1-64 karakter dan hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.`,
    );
  }
  return normalized;
}

export function validateFullName(value, label = 'Nama') {
  const normalized = String(value ?? '').trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new Error(`${label} wajib 1-200 karakter.`);
  }
  return normalized;
}

export function validatePassword(value) {
  if (!PASSWORD_PATTERN.test(String(value ?? ''))) {
    throw new Error(
      'Password wajib tepat 8 karakter alfanumerik serta memiliki huruf besar, huruf kecil, dan angka.',
    );
  }
  return value;
}

export function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = `${upper}${lower}${digits}`;
  const bytes = randomBytes(16);
  const characters = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    ...Array.from(
      { length: 5 },
      (_, index) => alphabet[bytes[index + 3] % alphabet.length],
    ),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index + 8] % (index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }
  return characters.join('');
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return [
    'scrypt',
    '1',
    '16384',
    '8',
    '1',
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export function validateSupabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('Supabase URL tidak valid.');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))) {
    throw new Error('Supabase URL hosted wajib menggunakan HTTPS.');
  }
  return url.toString().replace(/\/$/, '');
}

export function validateKey(value, label) {
  const normalized = String(value ?? '').trim();
  if (normalized.length < 16 || /replace|your-/i.test(normalized)) {
    throw new Error(`${label} belum valid atau masih berupa placeholder.`);
  }
  return normalized;
}

export function validateDatabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('Database connection string tidak valid.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Database connection string wajib menggunakan PostgreSQL.');
  }
  if (!url.hostname || !url.username || !url.password) {
    throw new Error('Database connection string wajib memiliki host, username, dan password.');
  }
  if (url.port === '6543') {
    throw new Error(
      'Transaction pooler port 6543 tidak mendukung migration. Gunakan direct connection atau session pooler port 5432.',
    );
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (!local && !['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) {
    throw new Error('Database hosted wajib memakai SSL; tambahkan sslmode=require pada connection string.');
  }
  return url.toString();
}

export function publicTargetSummary(supabaseUrl, databaseUrl) {
  const api = new URL(validateSupabaseUrl(supabaseUrl));
  const database = new URL(validateDatabaseUrl(databaseUrl));
  return {
    projectHost: api.hostname,
    databaseHost: database.hostname,
    databaseName: database.pathname.replace(/^\//, '') || 'postgres',
    databaseUser: database.username,
  };
}

export function sanitizeLogValue(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://[REDACTED]@')
    .replace(/\b(?:sb_(?:secret|publishable)_[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:password|secret|token|key)\s*[=:]\s*)\S+/gi, '$1[REDACTED]');
}

export function mergeEnvironment(existing, managedValues) {
  const managedNames = new Set(Object.keys(managedValues));
  const managedComment = '# Dikelola oleh npm run setup. Jangan commit file ini.';
  const output = [];
  for (const line of String(existing ?? '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (line === managedComment) continue;
    if (!match || !managedNames.has(match[1])) output.push(line);
  }
  while (output.length > 0 && output.at(-1) === '') output.pop();
  if (output.length > 0) output.push('');
  output.push(managedComment);
  for (const [name, rawValue] of Object.entries(managedValues)) {
    const value = String(rawValue).replace(/[\r\n]/g, '');
    output.push(`${name}=${value}`);
  }
  return `${output.join('\n')}\n`;
}

export async function loadMigrations(directory) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (names.length === 0) throw new Error('Tidak ada migration SQL yang ditemukan.');
  return Promise.all(names.map(async (name) => {
    const baseUrl = directory instanceof URL
      ? directory
      : new URL(`file:///${String(directory).replace(/\\/g, '/').replace(/^\//, '')}/`);
    const sql = await readFile(new URL(name, baseUrl), 'utf8');
    if (!sql.trim()) throw new Error(`Migration kosong: ${name}`);
    return {
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  }));
}
