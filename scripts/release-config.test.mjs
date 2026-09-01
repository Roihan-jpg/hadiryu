import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOSTED_PROJECT_REF,
  HOSTED_SUPABASE_URL,
  hostedCommands,
  loadHostedEnvironment,
  loadHostedSetupEnvironment,
  parseSupabaseStatus,
} from './release-config.mjs';

test('hosted release target is the confirmed Absensi Guru project', () => {
  assert.equal(HOSTED_PROJECT_REF, 'jlqzeytwwdnooepagknb');
  assert.equal(
    HOSTED_SUPABASE_URL,
    'https://jlqzeytwwdnooepagknb.supabase.co',
  );
});

test('parseSupabaseStatus maps local CLI keys without persisting them', () => {
  const result = parseSupabaseStatus(`API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="sb_publishable_local"\nSECRET_KEY="sb_secret_local"\n`);

  assert.deepEqual(result, {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local',
    SUPABASE_SECRET_KEY: 'sb_secret_local',
  });
});

test('loadHostedEnvironment rejects a different Supabase project URL', () => {
  assert.throws(
    () =>
      loadHostedEnvironment({
        SUPABASE_URL: 'https://wrong-project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable',
        SUPABASE_SECRET_KEY: 'secret',
        SUPER_ADMIN_NIP: 'admin-e2e',
        SUPER_ADMIN_FULL_NAME: 'Admin E2E',
        SUPER_ADMIN_INITIAL_PASSWORD: 'temporary-password',
        E2E_ADMIN_PASSWORD: 'changed-password',
        E2E_TEACHER_NIP: 'teacher-e2e',
        E2E_TEACHER_PASSWORD: 'teacher-password',
        E2E_LEAVE_DATE: '2026-09-01',
        E2E_LATITUDE: '-6.2',
        E2E_LONGITUDE: '106.8',
      }),
    new RegExp(HOSTED_PROJECT_REF),
  );
});

test('loadHostedEnvironment accepts only complete hosted smoke input', () => {
  const input = loadHostedEnvironment({
    SUPABASE_URL: HOSTED_SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    SUPABASE_SECRET_KEY: 'secret',
    SUPER_ADMIN_NIP: 'admin-e2e',
    SUPER_ADMIN_FULL_NAME: 'Admin E2E',
    SUPER_ADMIN_INITIAL_PASSWORD: 'temporary-password',
    E2E_ADMIN_PASSWORD: 'changed-password',
    E2E_TEACHER_NIP: 'teacher-e2e',
    E2E_TEACHER_PASSWORD: 'teacher-password',
    E2E_LEAVE_DATE: '2026-09-01',
    E2E_LATITUDE: '-6.2',
    E2E_LONGITUDE: '106.8',
  });

  assert.equal(input.SUPABASE_URL, HOSTED_SUPABASE_URL);
  assert.equal(input.E2E_LATITUDE, '-6.2');
});

test('loadHostedSetupEnvironment rejects a short initial teacher password', () => {
  assert.throws(() =>
    loadHostedSetupEnvironment({
      SUPABASE_URL: HOSTED_SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: 'publishable',
      SUPABASE_SECRET_KEY: 'secret',
      SUPER_ADMIN_NIP: 'admin-e2e',
      SUPER_ADMIN_FULL_NAME: 'Admin E2E',
      SUPER_ADMIN_INITIAL_PASSWORD: 'temporary-password',
      E2E_ADMIN_PASSWORD: 'changed-password',
      E2E_TEACHER_NIP: 'teacher-e2e',
      E2E_TEACHER_INITIAL_PASSWORD: 'short',
      E2E_TEACHER_PASSWORD: 'teacher-password',
      E2E_LEAVE_DATE: '2026-09-01',
      E2E_LATITUDE: '-6.2',
      E2E_LONGITUDE: '106.8',
    }),
  );
});

test('hostedCommands pins the target and never resets or seeds remote data', () => {
  const commands = ['link', 'deploy', 'advisors'].flatMap((action) =>
    hostedCommands(action),
  );
  const serialized = JSON.stringify(commands);

  assert.match(serialized, new RegExp(HOSTED_PROJECT_REF));
  assert.doesNotMatch(serialized, /reset|include-seed/);
  assert.deepEqual(hostedCommands('deploy'), [
    ['db', 'push', '--linked', '--dry-run'],
    ['db', 'push', '--linked', '--yes'],
  ]);
});
