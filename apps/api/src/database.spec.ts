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
const databaseTestPath = path.join(
  repositoryRoot,
  'supabase',
  'tests',
  'database.test.sql',
);

describe('database foundation', () => {
  it('satisfies the schema, constraint, immutability, and RLS contract', () => {
    const result = spawnSync(
      process.execPath,
      [
        supabaseCliPath,
        '--workdir',
        repositoryRoot,
        'test',
        'db',
        '--local',
        databaseTestPath,
      ],
      { encoding: 'utf8' },
    );

    const diagnostics = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n');

    expect(result.error, diagnostics).toBeUndefined();
    expect(result.status, diagnostics).toBe(0);
  }, 30_000);
});
