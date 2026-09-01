import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import {
  loadHostedEnvironment,
  loadHostedSetupEnvironment,
  parseSupabaseStatus,
} from './release-config.mjs';

const mode = process.argv[2] ?? 'local';
if (!['local', 'hosted', 'hosted-setup'].includes(mode)) {
  throw new Error('Mode E2E harus local, hosted, atau hosted-setup');
}

function run(
  script,
  args,
  environment,
  capture = false,
  workingDirectory = process.cwd(),
) {
  const result = spawnSync(process.execPath, [resolve(script), ...args], {
    cwd: workingDirectory,
    env: environment,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : '';
}

let runtimeEnvironment;
let testFile;
if (mode === 'local') {
  const status = run(
    'node_modules/supabase/dist/supabase.js',
    ['status', '-o', 'env'],
    process.env,
    true,
  );
  runtimeEnvironment = {
    ...process.env,
    ...parseSupabaseStatus(status),
    SESSION_COOKIE_SECURE: 'false',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4200',
    SUPER_ADMIN_NIP: 'e2e-admin',
    SUPER_ADMIN_FULL_NAME: 'Admin Smoke E2E',
    SUPER_ADMIN_INITIAL_PASSWORD: `LocalAdmin-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_ADMIN_PASSWORD: `LocalAdmin-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_TEACHER_NIP: 'e2e-guru',
    E2E_TEACHER_INITIAL_PASSWORD: `LocalGuru-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_TEACHER_PASSWORD: `LocalGuru-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_EARLY_TEACHER_NIP: 'e2e-guru-pulang-awal',
    E2E_EARLY_TEACHER_INITIAL_PASSWORD: `LocalGuruEarly-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_EARLY_TEACHER_PASSWORD: `LocalGuruEarly-${randomBytes(18).toString('base64url')}!aA1`,
    E2E_LATITUDE: '-6.200000',
    E2E_LONGITUDE: '106.816666',
  };
  testFile = 'e2e/local-release.spec.ts';
} else {
  let hostedEnvironment;
  try {
    hostedEnvironment = mode === 'hosted-setup'
      ? loadHostedSetupEnvironment(process.env)
      : loadHostedEnvironment(process.env);
  } catch (error) {
    const fields = Array.isArray(error?.issues)
      ? error.issues.map((issue) => issue.path.join('.')).join(', ')
      : 'environment hosted';
    throw new Error(`Konfigurasi smoke hosted tidak valid: ${fields}`, {
      cause: error,
    });
  }
  runtimeEnvironment = {
    ...process.env,
    ...hostedEnvironment,
    SESSION_COOKIE_SECURE: 'false',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4200',
  };
  testFile = mode === 'hosted-setup'
    ? 'e2e/hosted-setup.spec.ts'
    : 'e2e/hosted-release.spec.ts';
}

run(
  'node_modules/typescript/bin/tsc',
  ['-p', 'packages/contracts/tsconfig.build.json'],
  runtimeEnvironment,
);
// The workspace package version is intentionally static, so invalidate Angular's
// dependency prebundle after rebuilding contracts to avoid stale runtime exports.
run(
  'node_modules/@angular/cli/bin/ng.js',
  ['cache', 'clean'],
  runtimeEnvironment,
  false,
  resolve('apps/web'),
);
run(
  'node_modules/tsx/dist/cli.mjs',
  ['apps/api/src/bootstrap-super-admin.ts'],
  runtimeEnvironment,
);
run(
  'node_modules/@playwright/test/cli.js',
  ['test', testFile],
  runtimeEnvironment,
);
