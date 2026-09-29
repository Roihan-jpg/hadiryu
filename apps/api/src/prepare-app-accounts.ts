import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { bootstrapSuperAdmin, hashPassword, loadSupabaseAuthConfig } from './supabase-auth.js';

const EnvironmentSchema = z.strictObject({
  teacherPassword: z.string(),
  adminNip: z.string(),
  adminFullName: z.string(),
  adminPassword: z.string(),
});

async function main(): Promise<void> {
  const config = loadSupabaseAuthConfig(process.env);
  const input = EnvironmentSchema.parse({
    teacherPassword: process.env['APP_ACCOUNT_TEACHER_PASSWORD'],
    adminNip: process.env['APP_ACCOUNT_ADMIN_NIP'],
    adminFullName: process.env['APP_ACCOUNT_ADMIN_FULL_NAME'],
    adminPassword: process.env['APP_ACCOUNT_ADMIN_PASSWORD'],
  });
  const client = createClient(config.url, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: teachers, error } = await client.from('profiles').select('id').in('role', ['USER', 'SECURITY_GUARD']);
  if (error) throw error;
  for (const teacher of teachers ?? []) {
    const { error: accountError } = await client.from('app_accounts').upsert({
      profile_id: teacher.id,
      password_hash: await hashPassword(input.teacherPassword),
      password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    }, { onConflict: 'profile_id' });
    if (accountError) throw accountError;
  }
  await bootstrapSuperAdmin(config, {
    nip: input.adminNip,
    fullName: input.adminFullName,
    password: input.adminPassword,
  });
  process.stdout.write(`Akun aplikasi siap untuk ${teachers?.length ?? 0} Guru/Satpam dan satu Super Admin.\n`);
}

await main();
