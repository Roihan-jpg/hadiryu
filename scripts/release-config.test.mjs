import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hostedCommands,
  loadGuru8UiFixtureHostedEnvironment,
  loadHostedEnvironment,
  loadHostedSetupEnvironment,
  parseSupabaseStatus,
  projectRefFromSupabaseUrl,
} from './release-config.mjs';

const hostedUrl = 'https://buyerproject.supabase.co';

function hostedInput(overrides = {}) {
  return {
    SUPABASE_URL: hostedUrl,
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key-value',
    SUPABASE_SECRET_KEY: 'secret-key-value',
    SUPER_ADMIN_NIP: 'admin-e2e',
    SUPER_ADMIN_FULL_NAME: 'Admin E2E',
    SUPER_ADMIN_INITIAL_PASSWORD: 'Admin123',
    E2E_ADMIN_PASSWORD: 'Admin456',
    E2E_TEACHER_NIP: 'teacher-e2e',
    E2E_TEACHER_PASSWORD: 'Teach123',
    E2E_LEAVE_DATE: '2026-09-01',
    E2E_LATITUDE: '-6.2',
    E2E_LONGITUDE: '106.8',
    ...overrides,
  };
}

test('hosted target is derived from the buyer Supabase URL', () => {
  assert.equal(projectRefFromSupabaseUrl(hostedUrl), 'buyerproject');
  assert.throws(() => projectRefFromSupabaseUrl('https://example.com'));
});

test('parseSupabaseStatus maps local CLI keys without persisting them', () => {
  const result = parseSupabaseStatus(`API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="sb_publishable_local"\nSECRET_KEY="sb_secret_local"\n`);
  assert.deepEqual(result, {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local',
    SUPABASE_SECRET_KEY: 'sb_secret_local',
  });
});

test('loadHostedEnvironment accepts complete input for any Supabase buyer project', () => {
  const input = loadHostedEnvironment(hostedInput());
  assert.equal(input.SUPABASE_URL, hostedUrl);
  assert.equal(input.E2E_LATITUDE, '-6.2');
});

test('guru8 hosted fixture accepts a valid buyer project URL', () => {
  const input = loadGuru8UiFixtureHostedEnvironment({
    SUPABASE_URL: hostedUrl,
    SUPABASE_PUBLISHABLE_KEY: 'publishable-key-value',
    SUPABASE_SECRET_KEY: 'secret-key-value',
  });
  assert.equal(input.SUPABASE_URL, hostedUrl);
});

test('loadHostedSetupEnvironment rejects an invalid initial teacher password', () => {
  assert.throws(() => loadHostedSetupEnvironment(hostedInput({
    E2E_TEACHER_INITIAL_PASSWORD: 'short',
  })));
});

test('hostedCommands pins the requested buyer target and never resets or seeds remote data', () => {
  const projectRef = projectRefFromSupabaseUrl(hostedUrl);
  const commands = ['link', 'deploy', 'advisors'].flatMap((action) =>
    hostedCommands(action, projectRef),
  );
  const serialized = JSON.stringify(commands);
  assert.match(serialized, /buyerproject/);
  assert.doesNotMatch(serialized, /reset|include-seed/);
  assert.deepEqual(hostedCommands('deploy', projectRef), [
    ['db', 'push', '--linked', '--dry-run'],
    ['db', 'push', '--linked', '--yes'],
  ]);
});
