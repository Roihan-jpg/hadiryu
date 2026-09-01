import { z } from 'zod';

export const HOSTED_PROJECT_REF = 'jlqzeytwwdnooepagknb';
export const HOSTED_SUPABASE_URL = `https://${HOSTED_PROJECT_REF}.supabase.co`;

const RequiredText = z.string().trim().min(1);

const HostedEnvironmentSchema = z.strictObject({
  SUPABASE_URL: z.literal(HOSTED_SUPABASE_URL),
  SUPABASE_PUBLISHABLE_KEY: RequiredText,
  SUPABASE_SECRET_KEY: RequiredText,
  SUPER_ADMIN_NIP: RequiredText,
  SUPER_ADMIN_FULL_NAME: RequiredText,
  SUPER_ADMIN_INITIAL_PASSWORD: z.string().min(8),
  E2E_ADMIN_PASSWORD: z.string().min(8),
  E2E_TEACHER_NIP: RequiredText,
  E2E_TEACHER_PASSWORD: z.string().min(8),
  E2E_LEAVE_DATE: z.iso.date(),
  E2E_LATITUDE: z.string().refine(
    (value) => Number.isFinite(Number(value)) && Number(value) >= -90 && Number(value) <= 90,
    'E2E_LATITUDE harus berupa koordinat valid',
  ),
  E2E_LONGITUDE: z.string().refine(
    (value) => Number.isFinite(Number(value)) && Number(value) >= -180 && Number(value) <= 180,
    'E2E_LONGITUDE harus berupa koordinat valid',
  ),
});

const HostedSetupEnvironmentSchema = HostedEnvironmentSchema.extend({
  E2E_TEACHER_INITIAL_PASSWORD: z.string().min(8),
});

const HostedCliEnvironmentSchema = z.strictObject({
  SUPABASE_ACCESS_TOKEN: RequiredText,
  SUPABASE_DB_PASSWORD: RequiredText,
});

function selected(environment, names) {
  return Object.fromEntries(names.map((name) => [name, environment[name]]));
}

export function loadHostedEnvironment(environment) {
  return HostedEnvironmentSchema.parse(
    selected(environment, Object.keys(HostedEnvironmentSchema.shape)),
  );
}

export function loadHostedSetupEnvironment(environment) {
  return HostedSetupEnvironmentSchema.parse(
    selected(environment, Object.keys(HostedSetupEnvironmentSchema.shape)),
  );
}

export function loadHostedCliEnvironment(environment) {
  return HostedCliEnvironmentSchema.parse(
    selected(environment, Object.keys(HostedCliEnvironmentSchema.shape)),
  );
}

export function parseSupabaseStatus(output) {
  const values = Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator < 1) return [line, ''];
        const key = line.slice(0, separator);
        const rawValue = line.slice(separator + 1);
        return [key, rawValue.replace(/^"|"$/g, '')];
      }),
  );

  return z
    .strictObject({
      SUPABASE_URL: z.url(),
      SUPABASE_PUBLISHABLE_KEY: RequiredText,
      SUPABASE_SECRET_KEY: RequiredText,
    })
    .parse({
      SUPABASE_URL: values['API_URL'],
      SUPABASE_PUBLISHABLE_KEY: values['PUBLISHABLE_KEY'] ?? values['ANON_KEY'],
      SUPABASE_SECRET_KEY: values['SECRET_KEY'] ?? values['SERVICE_ROLE_KEY'],
    });
}

export function hostedCommands(action) {
  if (action === 'link') {
    return [['link', '--project-ref', HOSTED_PROJECT_REF, '--yes']];
  }
  if (action === 'deploy') {
    return [
      ['db', 'push', '--linked', '--dry-run'],
      ['db', 'push', '--linked', '--yes'],
    ];
  }
  if (action === 'advisors') {
    return [[
      'db',
      'advisors',
      '--linked',
      '--type',
      'all',
      '--level',
      'warn',
      '--fail-on',
      'warn',
    ]];
  }
  throw new Error(`Aksi hosted tidak dikenal: ${String(action)}`);
}
