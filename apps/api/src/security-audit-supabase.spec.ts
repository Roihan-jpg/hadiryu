import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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
const testPath = path.join(
  repositoryRoot,
  'supabase',
  'tests',
  'security-audit.test.sql',
);

describe('security audit Supabase regression', () => {
  it('keeps role authorization and RLS fail-closed', () => {
    const result = spawnSync(
      process.execPath,
      [supabaseCliPath, '--workdir', repositoryRoot, 'test', 'db', '--local', testPath],
      { encoding: 'utf8' },
    );
    const diagnostics = [result.stdout, result.stderr].filter(Boolean).join('\n');

    expect(result.error, diagnostics).toBeUndefined();
    expect(result.status, diagnostics).toBe(0);
  }, 30_000);
});
