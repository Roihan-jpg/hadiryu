import {
  AuthUserSchema,
  NewPasswordSchema,
  NipSchema,
  UserRoleSchema,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
} from '@absensi/contracts';
import {
  createClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { z } from 'zod';

import {
  AppError,
  type AuthService,
  type SessionResult,
} from './auth.js';

const ProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: NipSchema,
  full_name: z.string().trim().min(1).max(200),
  role: UserRoleSchema,
  is_active: z.boolean(),
  must_change_password: z.boolean(),
});

const AuthSessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

const SupabaseAuthConfigSchema = z.strictObject({
  url: z.url(),
  publishableKey: z.string().min(1),
  secretKey: z.string().min(1),
});

const BootstrapInputSchema = z.strictObject({
  nip: NipSchema,
  fullName: z.string().trim().min(1).max(200),
  password: NewPasswordSchema,
});

export type SupabaseAuthConfig = z.infer<typeof SupabaseAuthConfigSchema>;
export type BootstrapSuperAdminInput = z.infer<typeof BootstrapInputSchema>;

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function toAuthUser(row: z.infer<typeof ProfileRowSchema>): AuthUser {
  return AuthUserSchema.parse({
    id: row.id,
    nip: row.nip,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
  });
}

function toSessionResult(session: Session, user: AuthUser): SessionResult {
  const tokens = AuthSessionSchema.parse(session);
  return {
    user,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  };
}

export function internalEmailForNip(nip: string): string {
  return `${NipSchema.parse(nip).toLowerCase()}@absensi.invalid`;
}

export function loadSupabaseAuthConfig(
  environment: NodeJS.ProcessEnv,
): SupabaseAuthConfig {
  return SupabaseAuthConfigSchema.parse({
    url: environment['SUPABASE_URL'],
    publishableKey:
      environment['SUPABASE_PUBLISHABLE_KEY'] ??
      environment['SUPABASE_ANON_KEY'],
    secretKey:
      environment['SUPABASE_SECRET_KEY'] ??
      environment['SUPABASE_SERVICE_ROLE_KEY'],
  });
}

export class SupabaseAuthService implements AuthService {
  private readonly serviceClient: SupabaseClient;

  constructor(private readonly config: SupabaseAuthConfig) {
    SupabaseAuthConfigSchema.parse(config);
    this.serviceClient = createClient(config.url, config.secretKey, clientOptions());
  }

  private publicClient(): SupabaseClient {
    return createClient(
      this.config.url,
      this.config.publishableKey,
      clientOptions(),
    );
  }

  private async loadProfile(userId: string): Promise<AuthUser> {
    const { data, error } = await this.serviceClient
      .from('profiles')
      .select('id,nip,full_name,role,is_active,must_change_password')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      throw new AppError(500, 'PROFILE_LOOKUP_FAILED', 'Profil tidak dapat dimuat');
    }
    if (!data) {
      throw new AppError(403, 'PROFILE_NOT_FOUND', 'Profil akun tidak ditemukan');
    }

    const parsed = ProfileRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new AppError(500, 'PROFILE_INVALID', 'Data profil tidak valid');
    }
    return toAuthUser(parsed.data);
  }

  private async loadActiveProfile(userId: string): Promise<AuthUser> {
    const user = await this.loadProfile(userId);
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'Akun dinonaktifkan');
    }
    return user;
  }

  async login(input: LoginRequest): Promise<SessionResult> {
    const client = this.publicClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: internalEmailForNip(input.nip),
      password: input.password,
    });
    if (error || !data.session || !data.user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'NIP atau password salah');
    }

    try {
      const user = await this.loadActiveProfile(data.user.id);
      return toSessionResult(data.session, user);
    } catch (error) {
      await client.auth.signOut({ scope: 'local' });
      throw error;
    }
  }

  async refresh(refreshToken: string): Promise<SessionResult> {
    const client = this.publicClient();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session || !data.user) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sesi tidak dapat diperbarui');
    }

    try {
      const user = await this.loadActiveProfile(data.user.id);
      return toSessionResult(data.session, user);
    } catch (error) {
      await client.auth.signOut({ scope: 'local' });
      throw error;
    }
  }

  async authenticate(accessToken: string): Promise<AuthUser> {
    const { data, error } = await this.publicClient().auth.getUser(accessToken);
    if (error || !data.user) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sesi tidak valid');
    }
    return this.loadActiveProfile(data.user.id);
  }

  async changePassword(
    accessToken: string,
    _refreshToken: string,
    input: ChangePasswordRequest,
  ): Promise<SessionResult> {
    const currentUser = await this.authenticate(accessToken);
    const client = this.publicClient();
    const { data: currentLogin, error: signInError } =
      await client.auth.signInWithPassword({
        email: internalEmailForNip(currentUser.nip),
        password: input.currentPassword,
      });
    if (signInError || !currentLogin.session) {
      throw new AppError(
        400,
        'INVALID_CURRENT_PASSWORD',
        'Password saat ini salah',
      );
    }

    const { error: passwordError } = await client.auth.updateUser({
      password: input.newPassword,
    });
    if (passwordError) {
      throw new AppError(
        422,
        'PASSWORD_UPDATE_FAILED',
        'Password baru tidak dapat digunakan',
      );
    }

    const { error: profileError } = await this.serviceClient
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', currentUser.id);
    if (profileError) {
      throw new AppError(500, 'PROFILE_UPDATE_FAILED', 'Profil tidak dapat diperbarui');
    }

    const { error: auditError } = await this.serviceClient
      .from('audit_logs')
      .insert({
        actor_id: currentUser.id,
        action: 'PASSWORD_CHANGED',
        entity_type: 'profiles',
        entity_id: currentUser.id,
        before_data: { mustChangePassword: currentUser.mustChangePassword },
        after_data: { mustChangePassword: false },
      });
    if (auditError) {
      throw new AppError(500, 'AUDIT_WRITE_FAILED', 'Audit tidak dapat dicatat');
    }

    const { data: refreshed, error: refreshError } =
      await client.auth.refreshSession({
        refresh_token: currentLogin.session.refresh_token,
      });
    if (refreshError || !refreshed.session || !refreshed.user) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login kembali');
    }
    const user = await this.loadActiveProfile(refreshed.user.id);
    return toSessionResult(refreshed.session, user);
  }

  async logout(accessToken?: string): Promise<void> {
    if (!accessToken) return;
    const { error } = await this.serviceClient.auth.admin.signOut(
      accessToken,
      'local',
    );
    if (error) throw error;
  }
}

export async function bootstrapSuperAdmin(
  config: SupabaseAuthConfig,
  input: BootstrapSuperAdminInput,
): Promise<AuthUser> {
  const parsedConfig = SupabaseAuthConfigSchema.parse(config);
  const parsedInput = BootstrapInputSchema.parse(input);
  const nip = parsedInput.nip.toLowerCase();
  const client = createClient(
    parsedConfig.url,
    parsedConfig.secretKey,
    clientOptions(),
  );
  const { data: existing, error: lookupError } = await client
    .from('profiles')
    .select('id,nip,full_name,role,is_active,must_change_password')
    .eq('nip', nip)
    .maybeSingle();
  if (lookupError) {
    throw new AppError(500, 'PROFILE_LOOKUP_FAILED', 'Profil tidak dapat dimuat');
  }
  if (existing) {
    const profile = toAuthUser(ProfileRowSchema.parse(existing));
    if (profile.role !== 'SUPER_ADMIN') {
      throw new AppError(409, 'NIP_ALREADY_EXISTS', 'NIP sudah digunakan');
    }
    return profile;
  }

  const { data: created, error: createError } =
    await client.auth.admin.createUser({
      email: internalEmailForNip(nip),
      password: parsedInput.password,
      email_confirm: true,
      app_metadata: { role: 'SUPER_ADMIN' },
    });
  if (createError || !created.user) {
    throw new AppError(
      500,
      'SUPER_ADMIN_BOOTSTRAP_FAILED',
      'SuperAdmin tidak dapat dibuat',
    );
  }

  const profileRow = {
    id: created.user.id,
    nip,
    full_name: parsedInput.fullName,
    role: 'SUPER_ADMIN' as const,
    is_active: true,
    must_change_password: true,
  };
  const { error: profileError } = await client
    .from('profiles')
    .insert(profileRow);
  if (profileError) {
    await client.auth.admin.deleteUser(created.user.id);
    throw new AppError(
      500,
      'SUPER_ADMIN_BOOTSTRAP_FAILED',
      'Profil SuperAdmin tidak dapat dibuat',
    );
  }

  const { error: auditError } = await client.from('audit_logs').insert({
    actor_id: created.user.id,
    action: 'SUPER_ADMIN_BOOTSTRAPPED',
    entity_type: 'profiles',
    entity_id: created.user.id,
    after_data: {
      nip,
      fullName: parsedInput.fullName,
      role: 'SUPER_ADMIN',
      isActive: true,
      mustChangePassword: true,
    },
  });
  if (auditError) {
    await client.from('profiles').delete().eq('id', created.user.id);
    await client.auth.admin.deleteUser(created.user.id);
    throw new AppError(
      500,
      'SUPER_ADMIN_BOOTSTRAP_FAILED',
      'Audit bootstrap SuperAdmin tidak dapat dicatat',
    );
  }

  return toAuthUser(ProfileRowSchema.parse(profileRow));
}
