import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMigrationPlan, shouldRotateSetupPassword } from './database.mjs';

const migrations = [
  { name: '20260101000000_one.sql', checksum: 'a'.repeat(64), sql: 'select 1' },
  { name: '20260102000000_two.sql', checksum: 'b'.repeat(64), sql: 'select 2' },
];

test('migration plan applies only pending files in order', () => {
  assert.deepEqual(
    buildMigrationPlan(migrations, [{ name: migrations[0].name, checksum: migrations[0].checksum }]),
    [migrations[1]],
  );
});

test('migration plan rejects drift and unknown database migrations', () => {
  assert.throws(
    () => buildMigrationPlan(migrations, [{ name: migrations[0].name, checksum: 'c'.repeat(64) }]),
    /Checksum migration berubah/,
  );
  assert.throws(
    () => buildMigrationPlan(migrations, [{ name: 'unknown.sql', checksum: 'a'.repeat(64) }]),
    /tidak dikenal/,
  );
});

test('incomplete setup rotates only the exact account recorded by the installer', () => {
  assert.equal(shouldRotateSetupPassword('profile-a', 'profile-a'), true);
  assert.equal(shouldRotateSetupPassword('profile-b', 'profile-a'), false);
  assert.equal(shouldRotateSetupPassword('profile-a', null), false);
});
