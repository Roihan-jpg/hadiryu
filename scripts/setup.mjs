import { access } from 'node:fs/promises';

import {
  applyMigrations,
  completeInstallation,
  createDatabaseClient,
  prepareInitialAccounts,
  validateDatabaseSchema,
} from './setup/database.mjs';
import {
  parseEnvironment,
  readEnvironmentFile,
  writeRuntimeEnvironment,
} from './setup/environment.mjs';
import {
  assertSupportedNodeVersion,
  assertSupportedNpmUserAgent,
  loadMigrations,
} from './setup/core.mjs';
import { SetupLogger } from './setup/logger.mjs';
import { collectSetupInput } from './setup/prompts.mjs';
import { validateCredentials, validateInstallation } from './setup/validation.mjs';

const rootUrl = new URL('../', import.meta.url);
const envUrl = new URL('.env', rootUrl);
const logger = new SetupLogger(new URL('logs/setup.log', rootUrl));
const validateOnly = process.argv.includes('--validate');
const nonInteractive = process.argv.includes('--non-interactive');

async function preflight() {
  assertSupportedNodeVersion();
  for (const relativePath of [
    'package.json',
    'apps/api/package.json',
    'apps/web/package.json',
    'supabase/migrations',
  ]) {
    await access(new URL(relativePath, rootUrl));
  }
  assertSupportedNpmUserAgent(process.env.npm_config_user_agent);
}

function step(number, label) {
  process.stdout.write(`\n[${number}/7] ${label}\n`);
}

function printCredential(label, account) {
  process.stdout.write(`\n${label}\n`);
  process.stdout.write(`  NIP/username: ${account.nip}\n`);
  if (account.password) {
    process.stdout.write(`  Password awal: ${account.password}\n`);
    process.stdout.write('  Simpan sekarang; password ini tidak ditulis ke file atau log.\n');
  } else {
    process.stdout.write('  Password: tidak diubah karena akun sudah ada.\n');
  }
}

async function main() {
  await logger.info(`Setup dimulai (validateOnly=${validateOnly}).`);
  step(1, 'Memeriksa runtime dan struktur project');
  await preflight();
  const currentSource = await readEnvironmentFile(envUrl);
  const currentEnvironment = { ...parseEnvironment(currentSource), ...process.env };

  step(2, 'Mengumpulkan dan memvalidasi konfigurasi');
  const input = await collectSetupInput(currentEnvironment, { nonInteractive });
  await validateCredentials(input);

  step(3, 'Menghubungkan database target');
  const client = await createDatabaseClient(input.databaseUrl);
  try {
    if (validateOnly) {
      step(4, 'Memvalidasi schema tanpa mengubah data');
      await validateDatabaseSchema(client);
      process.stdout.write('\nValidasi HadirYu berhasil. Tidak ada perubahan yang dibuat.\n');
      await logger.info('Validasi setup berhasil.');
      return;
    }

    step(4, 'Menerapkan migration database');
    const migrations = await loadMigrations(new URL('../supabase/migrations/', import.meta.url));
    const migrationResult = await applyMigrations(
      client,
      migrations,
      (message) => process.stdout.write(`  - ${message}\n`),
    );
    await logger.info(
      `Migration selesai: applied=${migrationResult.applied}, adopted=${migrationResult.adopted}.`,
    );

    step(5, 'Menulis konfigurasi runtime lokal');
    await writeRuntimeEnvironment(envUrl, currentSource, {
      SUPABASE_URL: input.supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: input.publishableKey,
      SUPABASE_SECRET_KEY: input.secretKey,
    });

    step(6, 'Menyiapkan akun awal HadirYu');
    const accounts = await prepareInitialAccounts(client, {
      admin: { nip: input.adminNip, fullName: input.adminFullName },
      teacher: {
        nip: input.teacherNip,
        fullName: input.teacherFullName,
        gender: input.teacherGender,
      },
    });

    step(7, 'Menjalankan validasi akhir');
    await validateInstallation(client, {
      adminNip: input.adminNip,
      teacherNip: input.teacherNip,
    });

    process.stdout.write('\nSetup HadirYu berhasil.\n');
    printCredential('SuperAdmin', accounts.admin);
    printCredential('Guru demo', accounts.teacher);
    process.stdout.write('\nLangkah berikutnya: jalankan `npm run dev`, login sebagai SuperAdmin, lalu atur Jadwal & Lokasi sebelum absensi digunakan.\n');
    await completeInstallation(client);
    await logger.info('Setup HadirYu selesai dengan sukses.');
  } finally {
    await client.end();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : 'Setup gagal karena error tidak dikenal.';
  process.stderr.write(`\nSetup HadirYu gagal: ${message}\n`);
  process.stderr.write('Periksa logs/setup.log. Secret dan password tidak ditulis ke log.\n');
  await logger.error(message).catch(() => {});
  process.exitCode = 1;
});
