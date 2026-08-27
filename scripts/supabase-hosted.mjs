import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HOSTED_PROJECT_REF,
  hostedCommands,
  loadHostedCliEnvironment,
} from './release-config.mjs';

const action = process.argv[2];
const supportedActions = new Set(['link', 'deploy', 'advisors']);

if (!supportedActions.has(action)) {
  throw new Error('Gunakan aksi hosted: link, deploy, atau advisors');
}

try {
  loadHostedCliEnvironment(process.env);
} catch {
  throw new Error(
    'SUPABASE_ACCESS_TOKEN dan SUPABASE_DB_PASSWORD wajib tersedia di environment.',
  );
}

if (action !== 'link') {
  const linkedRefPath = resolve('supabase/.temp/project-ref');
  let linkedRef;
  try {
    linkedRef = readFileSync(linkedRefPath, 'utf8').trim();
  } catch {
    throw new Error('Repository belum di-link. Jalankan npm run db:link:hosted.');
  }
  if (linkedRef !== HOSTED_PROJECT_REF) {
    throw new Error(
      `Project ter-link bukan ${HOSTED_PROJECT_REF}; command hosted dibatalkan.`,
    );
  }
}

for (const command of hostedCommands(action)) {
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/supabase/dist/supabase.js'), ...command],
    {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
