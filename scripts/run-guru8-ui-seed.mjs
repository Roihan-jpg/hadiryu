import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { parseSupabaseStatus } from './release-config.mjs';

if (!process.env.GURU8_UI_PASSWORD) {
  throw new Error('GURU8_UI_PASSWORD wajib diisi saat menjalankan fixture.');
}

function run(command, argumentsList, environment, capture = false) {
  const result = spawnSync(command, argumentsList, {
    cwd: process.cwd(),
    env: environment,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : '';
}

const status = run(
  process.execPath,
  [resolve('node_modules/supabase/dist/supabase.js'), 'status', '-o', 'env'],
  process.env,
  true,
);
const localEnvironment = {
  ...process.env,
  ...parseSupabaseStatus(status),
};
run(
  process.execPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), 'apps/api/src/seed-guru8-ui.ts'],
  localEnvironment,
);
