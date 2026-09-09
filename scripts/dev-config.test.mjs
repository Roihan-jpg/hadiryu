import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const localE2eRunner = readFileSync(
  new URL('./run-e2e.mjs', import.meta.url),
  'utf8',
);

test('root dev builds shared contracts before starting API and web servers', () => {
  assert.equal(
    packageJson.scripts.predev,
    'npm run build --workspace @absensi/contracts',
  );
});

test('local E2E resets its database so generated credentials are repeatable', () => {
  assert.match(localE2eRunner, /\['db', 'reset', '--local'\]/);
});
