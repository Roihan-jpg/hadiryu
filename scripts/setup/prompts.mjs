import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import {
  publicTargetSummary,
  validateDatabaseUrl,
  validateFullName,
  validateKey,
  validateNip,
  validateSupabaseUrl,
} from './core.mjs';

function secretFromEnvironment(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function askRequired(rl, label, defaultValue = '') {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askSecret(rl, output, label, existingValue, environmentName) {
  if (existingValue) {
    const useExisting = (await rl.question(`${label} sudah tersedia. Gunakan nilai tersebut? [Y/n]: `))
      .trim().toLowerCase();
    if (!useExisting || useExisting === 'y' || useExisting === 'yes') return existingValue;
  }
  const fromEnvironment = secretFromEnvironment(environmentName);
  if (fromEnvironment) return fromEnvironment;
  if (!process.stdin.isTTY) {
    throw new Error(`${label} wajib diberikan melalui environment ${environmentName} pada terminal non-interaktif.`);
  }
  process.stdout.write(`${label} (tersembunyi): `);
  output.muted = true;
  try {
    return (await rl.question('')).trim();
  } finally {
    output.muted = false;
    process.stdout.write('\n');
  }
}

class MaskedOutput extends Writable {
  muted = false;

  _write(chunk, encoding, callback) {
    if (!this.muted) process.stdout.write(chunk, encoding);
    callback();
  }
}

export async function collectSetupInput(currentEnvironment, options = {}) {
  const nonInteractive = options.nonInteractive === true;
  if (nonInteractive) {
    return normalizeInput({
      supabaseUrl: currentEnvironment.SUPABASE_URL,
      publishableKey: currentEnvironment.SUPABASE_PUBLISHABLE_KEY,
      secretKey: currentEnvironment.SUPABASE_SECRET_KEY,
      databaseUrl: secretFromEnvironment('HADIRYU_DATABASE_URL'),
      adminNip: process.env.HADIRYU_ADMIN_NIP ?? 'admin',
      adminFullName: process.env.HADIRYU_ADMIN_FULL_NAME ?? 'Administrator HadirYu',
      teacherNip: process.env.HADIRYU_DEMO_TEACHER_NIP ?? 'guru.demo',
      teacherFullName: process.env.HADIRYU_DEMO_TEACHER_NAME ?? 'Guru Demo',
      teacherGender: process.env.HADIRYU_DEMO_TEACHER_GENDER ?? 'FEMALE',
    });
  }

  const output = new MaskedOutput();
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const raw = {
      supabaseUrl: await askRequired(rl, 'Supabase project URL', currentEnvironment.SUPABASE_URL),
      publishableKey: await askSecret(
        rl,
        output,
        'Supabase publishable key',
        currentEnvironment.SUPABASE_PUBLISHABLE_KEY,
        'HADIRYU_PUBLISHABLE_KEY',
      ),
      secretKey: await askSecret(
        rl,
        output,
        'Supabase secret key',
        currentEnvironment.SUPABASE_SECRET_KEY,
        'HADIRYU_SECRET_KEY',
      ),
      databaseUrl: await askSecret(
        rl,
        output,
        'Database connection string',
        null,
        'HADIRYU_DATABASE_URL',
      ),
      adminNip: await askRequired(rl, 'NIP/username SuperAdmin', 'admin'),
      adminFullName: await askRequired(rl, 'Nama SuperAdmin', 'Administrator HadirYu'),
      teacherNip: await askRequired(rl, 'NIP/username Guru demo', 'guru.demo'),
      teacherFullName: await askRequired(rl, 'Nama Guru demo', 'Guru Demo'),
      teacherGender: (await askRequired(rl, 'Gender Guru demo (FEMALE/MALE)', 'FEMALE')).toUpperCase(),
    };
    const input = normalizeInput(raw);
    const summary = publicTargetSummary(input.supabaseUrl, input.databaseUrl);
    process.stdout.write('\nTarget instalasi:\n');
    process.stdout.write(`  Supabase: ${summary.projectHost}\n`);
    process.stdout.write(`  Database: ${summary.databaseUser}@${summary.databaseHost}/${summary.databaseName}\n`);
    process.stdout.write(`  SuperAdmin: ${input.adminNip} (${input.adminFullName})\n`);
    process.stdout.write(`  Guru demo: ${input.teacherNip} (${input.teacherFullName})\n`);
    const confirmation = (await rl.question('Lanjutkan instalasi ke target ini? Ketik LANJUT: ')).trim();
    if (confirmation !== 'LANJUT') throw new Error('Instalasi dibatalkan.');
    return input;
  } finally {
    rl.close();
  }
}

function normalizeInput(input) {
  if (!['FEMALE', 'MALE'].includes(input.teacherGender)) {
    throw new Error('Gender Guru demo wajib FEMALE atau MALE.');
  }
  return {
    supabaseUrl: validateSupabaseUrl(input.supabaseUrl),
    publishableKey: validateKey(input.publishableKey, 'Publishable key'),
    secretKey: validateKey(input.secretKey, 'Secret key'),
    databaseUrl: validateDatabaseUrl(input.databaseUrl),
    adminNip: validateNip(input.adminNip, 'NIP SuperAdmin').toLowerCase(),
    adminFullName: validateFullName(input.adminFullName, 'Nama SuperAdmin'),
    teacherNip: validateNip(input.teacherNip, 'NIP Guru demo').toLowerCase(),
    teacherFullName: validateFullName(input.teacherFullName, 'Nama Guru demo'),
    teacherGender: input.teacherGender,
  };
}
