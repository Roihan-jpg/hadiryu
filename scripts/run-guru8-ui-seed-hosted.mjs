import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  loadGuru8UiFixtureHostedEnvironment,
  projectRefFromSupabaseUrl,
} from './release-config.mjs';

if (!process.env.GURU8_UI_PASSWORD) {
  throw new Error('GURU8_UI_PASSWORD wajib diisi saat menjalankan fixture hosted.');
}

const hostedEnvironment = loadGuru8UiFixtureHostedEnvironment(process.env);
const hostedProjectRef = projectRefFromSupabaseUrl(hostedEnvironment.SUPABASE_URL);

const linkedProjectRef = readFileSync(
  resolve('supabase/.temp/project-ref'),
  'utf8',
).trim();
if (linkedProjectRef !== hostedProjectRef) {
  throw new Error(`Project ter-link bukan ${hostedProjectRef}; seed hosted dibatalkan.`);
}

const result = spawnSync(
  process.execPath,
  [resolve('node_modules/tsx/dist/cli.mjs'), 'apps/api/src/seed-guru8-ui-hosted.ts'],
  { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
