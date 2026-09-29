import { z } from 'zod';

import {
  bootstrapSuperAdmin,
  loadSupabaseAuthConfig,
} from './supabase-auth.js';

const BootstrapEnvironmentSchema = z.strictObject({
  nip: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(1),
});

async function main(): Promise<void> {
  const input = BootstrapEnvironmentSchema.parse({
    nip: process.env['SUPER_ADMIN_NIP'],
    fullName: process.env['SUPER_ADMIN_FULL_NAME'],
    password: process.env['SUPER_ADMIN_INITIAL_PASSWORD'],
  });
  await bootstrapSuperAdmin(loadSupabaseAuthConfig(process.env), input);
  console.log('SuperAdmin berhasil disiapkan.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Bootstrap gagal';
  console.error(message);
  process.exitCode = 1;
});
