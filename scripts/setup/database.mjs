import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { generatePassword, hashPassword } from './core.mjs';

const REQUIRED_TABLES = [
  'attendance_records',
  'attendance_admin_notes',
  'audit_logs',
  'app_accounts',
  'app_sessions',
  'calendar_exceptions',
  'early_departure_requests',
  'geofence_rules',
  'leave_requests',
  'payroll_rules',
  'profiles',
  'reporting_settings',
  'schedule_rules',
  'security_schedule_settings',
];

export function buildMigrationPlan(migrations, appliedRows) {
  const known = new Map(migrations.map((migration) => [migration.name, migration]));
  for (const row of appliedRows) {
    const migration = known.get(row.name);
    if (!migration) {
      throw new Error(`Database memiliki migration yang tidak dikenal: ${row.name}`);
    }
    if (migration.checksum !== row.checksum) {
      throw new Error(`Checksum migration berubah setelah diterapkan: ${row.name}`);
    }
  }
  const appliedNames = new Set(appliedRows.map((row) => row.name));
  return migrations.filter((migration) => !appliedNames.has(migration.name));
}

export function shouldRotateSetupPassword(profileId, rotateProfileId) {
  return typeof rotateProfileId === 'string' && rotateProfileId === profileId;
}

export async function createDatabaseClient(connectionString) {
  const client = new pg.Client({
    connectionString,
    application_name: 'hadiryu-setup',
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
  });
  await client.connect();
  await client.query('select 1');
  return client;
}

async function ensureInstallerSchema(client) {
  await client.query(`
    create schema if not exists hadiryu_internal;
    revoke all on schema hadiryu_internal from public, anon, authenticated;
    create table if not exists hadiryu_internal.schema_migrations (
      name text primary key,
      checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
      adopted boolean not null default false,
      applied_at timestamptz not null default now()
    );
    create table if not exists hadiryu_internal.installation_state (
      singleton boolean primary key default true check (singleton),
      status text not null check (status in ('IN_PROGRESS', 'COMPLETE')),
      admin_profile_id uuid,
      teacher_profile_id uuid,
      updated_at timestamptz not null default now()
    );
  `);
}

async function publicSchemaExists(client) {
  const result = await client.query(
    "select to_regclass('public.profiles') is not null as exists",
  );
  return result.rows[0]?.exists === true;
}

export async function validateDatabaseSchema(client) {
  const tables = await client.query(`
    select c.relname as name, c.relrowsecurity as rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [REQUIRED_TABLES]);
  const found = new Map(tables.rows.map((row) => [row.name, row.rls]));
  const missing = REQUIRED_TABLES.filter((name) => !found.has(name));
  if (missing.length > 0) {
    throw new Error(`Schema belum lengkap. Tabel tidak ditemukan: ${missing.join(', ')}`);
  }
  const rlsDisabled = REQUIRED_TABLES.filter((name) => found.get(name) !== true);
  if (rlsDisabled.length > 0) {
    throw new Error(`RLS tidak aktif pada: ${rlsDisabled.join(', ')}`);
  }
  const boundaries = await client.query(`
    select
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profiles' and column_name = 'gender'
      ) as has_gender,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'geofence_rules' and column_name = 'polygon_vertices'
      ) as has_polygon,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'leave_requests' and column_name = 'early_departure_end_date'
      ) as has_maternity_periods,
      has_table_privilege('authenticated', 'public.app_accounts', 'SELECT') as authenticated_reads_accounts,
      has_table_privilege('authenticated', 'public.app_sessions', 'SELECT') as authenticated_reads_sessions
  `);
  const result = boundaries.rows[0];
  if (!result?.has_gender || !result?.has_polygon || !result?.has_maternity_periods) {
    throw new Error('Schema belum mencapai versi HadirYu yang dibutuhkan.');
  }
  if (result.authenticated_reads_accounts || result.authenticated_reads_sessions) {
    throw new Error('Hak akses tabel autentikasi aplikasi terlalu luas.');
  }
  const enumValues = await client.query(`
    select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_catalog.pg_type t
    join pg_catalog.pg_enum e on e.enumtypid = t.oid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = any(array['user_role', 'schedule_type', 'leave_type'])
    group by t.typname
  `);
  const enums = new Map(enumValues.rows.map((row) => [row.typname, row.values]));
  for (const [name, required] of [
    ['user_role', ['SECURITY_GUARD']],
    ['schedule_type', ['SECURITY_DAY', 'SECURITY_NIGHT']],
    ['leave_type', ['LATE_ARRIVAL', 'MATERNITY_LEAVE']],
  ]) {
    const actual = enums.get(name) ?? [];
    if (required.some((value) => !actual.includes(value))) {
      throw new Error(`Enum ${name} belum mencapai versi HadirYu yang dibutuhkan.`);
    }
  }
  const buckets = await client.query(`
    select id from storage.buckets
    where id = any(array['profile-photos', 'request-attachments'])
  `);
  if (buckets.rowCount !== 2) {
    throw new Error('Bucket Storage privat HadirYu belum lengkap.');
  }
}

export async function applyMigrations(client, migrations, onProgress = () => {}) {
  await client.query("select pg_advisory_lock(hashtextextended('hadiryu.setup.migrations', 0))");
  try {
    await ensureInstallerSchema(client);
    const applied = await client.query(
      'select name, checksum from hadiryu_internal.schema_migrations order by name',
    );
    if (applied.rows.length === 0 && await publicSchemaExists(client)) {
      await validateDatabaseSchema(client);
      await client.query('begin');
      try {
        for (const migration of migrations) {
          await client.query(
            'insert into hadiryu_internal.schema_migrations(name, checksum, adopted) values ($1, $2, true)',
            [migration.name, migration.checksum],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      onProgress(`Mengadopsi ${migrations.length} migration dari schema HadirYu yang sudah ada.`);
      return { adopted: migrations.length, applied: 0 };
    }

    const pending = buildMigrationPlan(migrations, applied.rows);
    for (const migration of pending) {
      onProgress(`Menerapkan ${migration.name}`);
      await client.query('begin');
      try {
        await client.query(migration.sql);
        await client.query(
          'insert into hadiryu_internal.schema_migrations(name, checksum) values ($1, $2)',
          [migration.name, migration.checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration gagal pada ${migration.name}: ${error.message}`, { cause: error });
      }
    }
    await validateDatabaseSchema(client);
    return { adopted: 0, applied: pending.length };
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended('hadiryu.setup.migrations', 0))");
  }
}

async function upsertInitialAccount(client, input) {
  const existing = await client.query(
    'select id, role from public.profiles where lower(nip) = lower($1) limit 1',
    [input.nip],
  );
  if (existing.rows[0] && existing.rows[0].role !== input.role) {
    throw new Error(`NIP ${input.nip} sudah digunakan oleh role ${existing.rows[0].role}.`);
  }

  const profileId = existing.rows[0]?.id ?? randomUUID();
  let password = null;
  const createCredential = async () => {
    password = generatePassword();
    return hashPassword(password);
  };
  if (!existing.rows[0]) {
    const passwordHash = await createCredential();
    await client.query(`
      insert into public.profiles (
        id, nip, full_name, role, gender, is_active,
        must_change_password, temporary_password_expires_at
      ) values ($1, lower($2), $3, $4, $5, true, false, null)
    `, [profileId, input.nip, input.fullName, input.role, input.gender]);
    await client.query(
      'insert into public.app_accounts(profile_id, password_hash) values ($1, $2)',
      [profileId, passwordHash],
    );
  } else {
    const account = await client.query(
      'select profile_id from public.app_accounts where profile_id = $1',
      [profileId],
    );
    if (account.rowCount === 0) {
      const passwordHash = await createCredential();
      await client.query(
        'insert into public.app_accounts(profile_id, password_hash) values ($1, $2)',
        [profileId, passwordHash],
      );
    } else if (shouldRotateSetupPassword(profileId, input.rotateProfileId)) {
      const passwordHash = await createCredential();
      await client.query(`
        update public.app_accounts
        set password_hash = $2, password_changed_at = now(),
            failed_login_attempts = 0, locked_until = null
        where profile_id = $1
      `, [profileId, passwordHash]);
    }
  }
  return { profileId, nip: input.nip.toLowerCase(), password };
}

export async function prepareInitialAccounts(client, input) {
  await ensureInstallerSchema(client);
  const stateResult = await client.query(
    'select status, admin_profile_id, teacher_profile_id from hadiryu_internal.installation_state where singleton = true',
  );
  const priorState = stateResult.rows[0];
  const rotateIncomplete = priorState?.status === 'IN_PROGRESS';
  await client.query('begin');
  try {
    const admin = await upsertInitialAccount(client, {
      ...input.admin,
      role: 'SUPER_ADMIN',
      gender: null,
      rotateProfileId: rotateIncomplete ? priorState.admin_profile_id : null,
    });
    const teacher = await upsertInitialAccount(client, {
      ...input.teacher,
      role: 'USER',
      gender: input.teacher.gender ?? 'FEMALE',
      rotateProfileId: rotateIncomplete ? priorState.teacher_profile_id : null,
    });
    if (admin.password) {
      await client.query(`
        insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_data)
        values ($1, 'SUPER_ADMIN_BOOTSTRAPPED', 'profiles', $1,
          jsonb_build_object('nip', $2::text, 'fullName', $3::text, 'role', 'SUPER_ADMIN', 'isActive', true))
      `, [admin.profileId, input.admin.nip.toLowerCase(), input.admin.fullName]);
    }
    if (teacher.password) {
      await client.query(`
        insert into public.audit_logs(actor_id, action, entity_type, entity_id, after_data)
        values ($1, 'TEACHER_CREATED', 'profiles', $2,
          jsonb_build_object('nip', $3::text, 'fullName', $4::text, 'role', 'USER', 'isActive', true))
      `, [admin.profileId, teacher.profileId, input.teacher.nip.toLowerCase(), input.teacher.fullName]);
    }
    await client.query(`
      insert into hadiryu_internal.installation_state(
        singleton, status, admin_profile_id, teacher_profile_id, updated_at
      ) values (true, 'IN_PROGRESS', $1, $2, now())
      on conflict (singleton) do update set
        status = 'IN_PROGRESS', admin_profile_id = excluded.admin_profile_id,
        teacher_profile_id = excluded.teacher_profile_id, updated_at = now()
    `, [admin.profileId, teacher.profileId]);
    await client.query('commit');
    return { admin, teacher };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function completeInstallation(client) {
  const result = await client.query(`
    update hadiryu_internal.installation_state
    set status = 'COMPLETE', updated_at = now()
    where singleton = true and status = 'IN_PROGRESS'
  `);
  if (result.rowCount !== 1) throw new Error('State instalasi tidak dapat diselesaikan.');
}
