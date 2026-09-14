import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HOSTED_PROJECT_REF,
  loadGuru8UiFixtureHostedEnvironment,
} from './release-config.mjs';

if (!process.env.GURU8_UI_PASSWORD) {
  throw new Error('GURU8_UI_PASSWORD wajib diisi saat menjalankan fixture hosted.');
}

loadGuru8UiFixtureHostedEnvironment(process.env);

const linkedProjectRef = readFileSync(
  resolve('supabase/.temp/project-ref'),
  'utf8',
).trim();
if (linkedProjectRef !== HOSTED_PROJECT_REF) {
  throw new Error(`Project ter-link bukan ${HOSTED_PROJECT_REF}; seed hosted dibatalkan.`);
}

const result = spawnSync(
  process.execPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), 'apps/api/src/seed-guru8-ui-hosted.ts'],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
