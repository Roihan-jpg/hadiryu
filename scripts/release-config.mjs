import { z } from 'zod';

const RequiredText = z.string().trim().min(1);
const HostedUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname);
}, 'SUPABASE_URL wajib berupa URL project Supabase hosted');
const Password = z.string()
  .length(8)
  .regex(/^[A-Za-z0-9]+$/)
  .regex(/[A-Z]/)
  .regex(/[a-z]/)
  .regex(/[0-9]/);

const HostedEnvironmentSchema = z.strictObject({
  SUPABASE_URL: HostedUrl,
  SUPABASE_PUBLISHABLE_KEY: RequiredText,
  SUPABASE_SECRET_KEY: RequiredText,
  SUPER_ADMIN_NIP: RequiredText,
  SUPER_ADMIN_FULL_NAME: RequiredText,
  SUPER_ADMIN_INITIAL_PASSWORD: Password,
  E2E_ADMIN_PASSWORD: Password,
  E2E_TEACHER_NIP: RequiredText,
  E2E_TEACHER_PASSWORD: Password,
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
  E2E_TEACHER_INITIAL_PASSWORD: Password,
});

const Guru8UiFixtureHostedEnvironmentSchema = z.strictObject({
  SUPABASE_URL: HostedUrl,
  SUPABASE_PUBLISHABLE_KEY: RequiredText,
  SUPABASE_SECRET_KEY: RequiredText,
});

const HostedCliEnvironmentSchema = z.strictObject({
  SUPABASE_URL: HostedUrl,
  SUPABASE_ACCESS_TOKEN: RequiredText,
  SUPABASE_DB_PASSWORD: RequiredText,
});

export function projectRefFromSupabaseUrl(value) {
  const url = new URL(HostedUrl.parse(value));
  return url.hostname.slice(0, -'.supabase.co'.length);
}

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

export function loadGuru8UiFixtureHostedEnvironment(environment) {
  return Guru8UiFixtureHostedEnvironmentSchema.parse(
    selected(environment, Object.keys(Guru8UiFixtureHostedEnvironmentSchema.shape)),
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

export function hostedCommands(action, projectRef) {
  const parsedProjectRef = z.string().regex(/^[a-z0-9]+$/).parse(projectRef);
  if (action === 'link') {
    return [['link', '--project-ref', parsedProjectRef, '--yes']];
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
