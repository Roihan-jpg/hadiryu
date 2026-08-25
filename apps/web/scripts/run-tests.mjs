import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const angularCli = path.join(
  workspaceRoot,
  'node_modules',
  '@angular',
  'cli',
  'bin',
  'ng.js',
);
const filters = process.argv.slice(2).filter(Boolean);
const args = [angularCli, 'test'];

if (filters.length > 0) {
  for (const filter of filters) {
    args.push('--include', `**/*${filter}*.spec.ts`);
    args.push('--include', `**/${filter}/**/*.spec.ts`);
  }
}

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
