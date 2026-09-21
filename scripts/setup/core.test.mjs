import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedNodeVersion,
  assertSupportedNpmUserAgent,
  generatePassword,
  hashPassword,
  mergeEnvironment,
  publicTargetSummary,
  sanitizeLogValue,
  validateDatabaseUrl,
  validateNip,
  validatePassword,
  validateSupabaseUrl,
} from './core.mjs';

test('preflight accepts supported Node lines and rejects older runtimes', () => {
  assert.doesNotThrow(() => assertSupportedNodeVersion('22.22.3'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('24.15.0'));
  assert.doesNotThrow(() => assertSupportedNodeVersion('26.0.0'));
  assert.throws(() => assertSupportedNodeVersion('22.21.0'), /tidak didukung/);
  assert.throws(() => assertSupportedNodeVersion('25.0.0'), /tidak didukung/);
});

test('preflight reads npm version from the cross-platform npm user agent', () => {
  assert.equal(
    assertSupportedNpmUserAgent('npm/11.12.1 node/v24.15.0 win32 x64'),
    '11.12.1',
  );
  assert.throws(() => assertSupportedNpmUserAgent('npm/10.9.0 node/v22.22.3'));
  assert.throws(() => assertSupportedNpmUserAgent(undefined));
});

test('account validation mirrors the application auth contract', async () => {
  assert.equal(validateNip(' admin.hadiryu '), 'admin.hadiryu');
  assert.equal(validatePassword('Admin123'), 'Admin123');
  assert.throws(() => validateNip('admin hadiryu'));
  assert.throws(() => validatePassword('password'));
  for (let index = 0; index < 20; index += 1) {
    const password = generatePassword();
    assert.match(password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/);
    assert.match(await hashPassword(password), /^scrypt\$1\$16384\$8\$1\$/);
  }
});

test('hosted targets require HTTPS and a migration-safe SSL database URL', () => {
  assert.equal(
    validateSupabaseUrl('https://example.supabase.co/'),
    'https://example.supabase.co',
  );
  assert.throws(() => validateSupabaseUrl('http://example.supabase.co'));
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:secret@db.example.com:6543/postgres?sslmode=require'),
    /6543/,
  );
  assert.throws(
    () => validateDatabaseUrl('postgresql://postgres:secret@db.example.com:5432/postgres'),
    /sslmode=require/,
  );
  assert.deepEqual(
    publicTargetSummary(
      'https://example.supabase.co',
      'postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=require',
    ),
    {
      projectHost: 'example.supabase.co',
      databaseHost: 'db.example.com',
      databaseName: 'postgres',
      databaseUser: 'postgres',
    },
  );
});

test('environment merge replaces only managed keys and is repeatable', () => {
  const values = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    SUPABASE_SECRET_KEY: 'sb_secret_example',
  };
  const first = mergeEnvironment('CUSTOM=value\nSUPABASE_URL=old\n', values);
  const second = mergeEnvironment(first, values);
  assert.equal(second, first);
  assert.match(first, /^CUSTOM=value/m);
  assert.equal((first.match(/^SUPABASE_URL=/gm) ?? []).length, 1);
});

test('setup logs redact database credentials and API keys', () => {
  const message = sanitizeLogValue(
    'postgresql://postgres:very-secret@db.example.com/postgres key=sb_secret_abc1234567890',
  );
  assert.doesNotMatch(message, /very-secret|sb_secret_/);
  assert.match(message, /\[REDACTED\]/);
});
