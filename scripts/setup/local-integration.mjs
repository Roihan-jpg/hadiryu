import assert from 'node:assert/strict';

import { loadMigrations } from './core.mjs';
import {
  applyMigrations,
  completeInstallation,
  createDatabaseClient,
  prepareInitialAccounts,
} from './database.mjs';
import { validateInstallation } from './validation.mjs';

const connectionString = process.env.HADIRYU_LOCAL_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const client = await createDatabaseClient(connectionString);
const profileIds = [];
let pendingError;

try {
  const state = await client.query(
    'select status from hadiryu_internal.installation_state where singleton = true',
  ).catch(() => ({ rowCount: 0 }));
  if (state.rowCount !== 0) {
    throw new Error('Integration setup lokal membutuhkan installation_state kosong. Jalankan npm run db:reset dahulu.');
  }

  const migrations = await loadMigrations(new URL('../../supabase/migrations/', import.meta.url));
  const firstMigrationRun = await applyMigrations(client, migrations);
  assert.equal(firstMigrationRun.applied, 0);
  assert.equal(firstMigrationRun.adopted, migrations.length);

  const suffix = Date.now().toString(36);
  const input = {
    admin: { nip: `setup.admin.${suffix}`, fullName: 'Admin Integration Setup' },
    teacher: {
      nip: `setup.guru.${suffix}`,
      fullName: 'Guru Integration Setup',
      gender: 'FEMALE',
    },
  };
  const firstAccounts = await prepareInitialAccounts(client, input);
  profileIds.push(firstAccounts.admin.profileId, firstAccounts.teacher.profileId);
  assert.match(firstAccounts.admin.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/);
  assert.match(firstAccounts.teacher.password, /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/);
  await validateInstallation(client, {
    adminNip: input.admin.nip,
    teacherNip: input.teacher.nip,
  });
  await completeInstallation(client);

  const secondMigrationRun = await applyMigrations(client, migrations);
  assert.deepEqual(secondMigrationRun, { adopted: 0, applied: 0 });
  const secondAccounts = await prepareInitialAccounts(client, input);
  assert.equal(secondAccounts.admin.password, null);
  assert.equal(secondAccounts.teacher.password, null);
  await completeInstallation(client);

  process.stdout.write('Integration setup lokal lulus: adoption, akun awal, validasi, dan rerun idempoten.\n');
} catch (error) {
  pendingError = error;
} finally {
  if (profileIds.length > 0) {
    await client.query('begin');
    try {
      await client.query('set local session_replication_role = replica');
      await client.query(
        'delete from public.audit_logs where actor_id = any($1::uuid[]) or entity_id = any($1::uuid[])',
        [profileIds],
      );
      await client.query('delete from public.app_sessions where profile_id = any($1::uuid[])', [profileIds]);
      await client.query('delete from public.app_accounts where profile_id = any($1::uuid[])', [profileIds]);
      await client.query('delete from public.profiles where id = any($1::uuid[])', [profileIds]);
      await client.query('delete from hadiryu_internal.installation_state where singleton = true');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      pendingError ??= error;
    }
  }
  await client.end().catch((error) => {
    pendingError ??= error;
  });
}

if (pendingError) throw pendingError;
