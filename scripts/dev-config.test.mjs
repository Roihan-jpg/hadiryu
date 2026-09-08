import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

test('root dev builds shared contracts before starting API and web servers', () => {
  assert.equal(
    packageJson.scripts.predev,
    'npm run build --workspace @absensi/contracts',
  );
});
