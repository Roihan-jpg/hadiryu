import {
  AuthUserSchema,
  NewPasswordSchema,
  NipSchema,
  UserRoleSchema,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';

import { AppError, type AuthService, type SessionResult } from './auth.js';

const SCRYPT_VERSION = '1';
const SCRYPT_KEY_LENGTH = 64;
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOCK_SECONDS = 15 * 60;
const MAX_LOGIN_FAILURES = 5;

const ProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: NipSchema,
  full_name: z.string().trim().min(1).max(200),
  role: UserRoleSchema,
  is_active: z.boolean(),
  profile_photo_mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable(),
  profile_photo_size_bytes: z.number().int().positive().max(2 * 1024 * 1024).nullable(),
  profile_photo_updated_at: z.string().nullable(),
});

const AccountRowSchema = z.strictObject({
  profile_id: z.uuid(),
  password_hash: z.string().min(1),
  failed_login_attempts: z.number().int().min(0).max(MAX_LOGIN_FAILURES),
  locked_until: z.string().nullable(),
});

const SessionRowSchema = z.strictObject({
  profile_id: z.uuid(),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
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

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: 16_384, r: 8, p: 1 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const parsed = NewPasswordSchema.parse(password);
  const salt = randomBytes(16);
  const derivedKey = await scrypt(parsed, salt);
  return [
    'scrypt',
    SCRYPT_VERSION,
    '16384',
    '8',
    '1',
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (
    parts.length !== 7 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== SCRYPT_VERSION ||
    parts[2] !== '16384' ||
    parts[3] !== '8' ||
    parts[4] !== '1'
  ) return false;

  try {
    const salt = Buffer.from(parts[5]!, 'base64url');
    const expected = Buffer.from(parts[6]!, 'base64url');
    const actual = await scrypt(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

const DUMMY_HASH_PROMISE = hashPassword('Dummy123');

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAuthUser(row: z.infer<typeof ProfileRowSchema>): AuthUser {
  const hasPhoto =
    row.profile_photo_mime_type !== null &&
    row.profile_photo_size_bytes !== null &&
    row.profile_photo_updated_at !== null;
  return AuthUserSchema.parse({
    id: row.id,
    nip: row.nip,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: false,
    photo: hasPhoto
      ? {
          mimeType: row.profile_photo_mime_type,
          sizeBytes: row.profile_photo_size_bytes,
          updatedAt: new Date(row.profile_photo_updated_at!).toISOString(),
        }
      : null,
  });
}

function parseProfile(value: unknown): AuthUser {
  const result = ProfileRowSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(500, 'PROFILE_INVALID', 'Data profil tidak valid');
  }
  return toAuthUser(result.data);
}

export function internalEmailForNip(nip: string): string {
  return `${NipSchema.parse(nip).toLowerCase()}@absensi.invalid`;
}

export function loadSupabaseAuthConfig(
  environment: Record<string, string | undefined>,
): SupabaseAuthConfig {
  return SupabaseAuthConfigSchema.parse({
    url: environment['SUPABASE_URL'],
    publishableKey:
      environment['SUPABASE_PUBLISHABLE_KEY'] ?? environment['SUPABASE_ANON_KEY'],
    secretKey:
      environment['SUPABASE_SECRET_KEY'] ?? environment['SUPABASE_SERVICE_ROLE_KEY'],
  });
}

export class SupabaseAuthService implements AuthService {
  private readonly serviceClient: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    const parsed = SupabaseAuthConfigSchema.parse(config);
    this.serviceClient = createClient(parsed.url, parsed.secretKey, clientOptions());
  }

  private async loadProfile(profileId: string): Promise<AuthUser> {
    const { data, error } = await this.serviceClient
      .from('profiles')
      .select('id,nip,full_name,role,is_active,profile_photo_mime_type,profile_photo_size_bytes,profile_photo_updated_at')
      .eq('id', profileId)
      .maybeSingle();
    if (error) {
      throw new AppError(500, 'PROFILE_LOOKUP_FAILED', 'Profil tidak dapat dimuat');
    }
    if (!data) {
      throw new AppError(403, 'PROFILE_NOT_FOUND', 'Profil akun tidak ditemukan');
    }
    return parseProfile(data);
  }

  private async loadActiveProfile(profileId: string): Promise<AuthUser> {
    const user = await this.loadProfile(profileId);
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'Akun dinonaktifkan');
    }
    return user;
  }

  private async createSession(user: AuthUser): Promise<SessionResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    const { error } = await this.serviceClient.from('app_sessions').insert({
      token_hash: tokenHash(token),
      profile_id: user.id,
      expires_at: expiresAt,
    });
    if (error) {
      throw new AppError(500, 'SESSION_CREATE_FAILED', 'Sesi tidak dapat dibuat');
    }
    return {
      user,
      accessToken: token,
      refreshToken: '',
      expiresIn: SESSION_SECONDS,
    };
  }

  private async recordFailedLogin(
    account: z.infer<typeof AccountRowSchema>,
  ): Promise<void> {
    const attempts = Math.min(account.failed_login_attempts + 1, MAX_LOGIN_FAILURES);
    const lockedUntil = attempts >= MAX_LOGIN_FAILURES
      ? new Date(Date.now() + LOCK_SECONDS * 1000).toISOString()
      : null;
    await this.serviceClient
      .from('app_accounts')
      .update({ failed_login_attempts: attempts, locked_until: lockedUntil })
      .eq('profile_id', account.profile_id);
  }

  async login(input: LoginRequest): Promise<SessionResult> {
    const nip = input.nip.toLowerCase();
    const { data: profileData, error: profileError } = await this.serviceClient
      .from('profiles')
      .select('id,nip,full_name,role,is_active,profile_photo_mime_type,profile_photo_size_bytes,profile_photo_updated_at')
      .eq('nip', nip)
      .maybeSingle();
    if (profileError) {
      throw new AppError(500, 'LOGIN_FAILED', 'Login tidak dapat diproses');
    }

    if (!profileData) {
      await verifyPassword(input.password, await DUMMY_HASH_PROMISE);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'NIP atau password salah');
    }

    const user = parseProfile(profileData);
    const { data: accountData, error: accountError } = await this.serviceClient
      .from('app_accounts')
      .select('profile_id,password_hash,failed_login_attempts,locked_until')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (accountError) {
      throw new AppError(500, 'LOGIN_FAILED', 'Login tidak dapat diproses');
    }
    if (!accountData) {
      await verifyPassword(input.password, await DUMMY_HASH_PROMISE);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'NIP atau password salah');
    }

    const account = AccountRowSchema.parse(accountData);
    if (account.locked_until && Date.parse(account.locked_until) > Date.now()) {
      await verifyPassword(input.password, account.password_hash);
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Akun dikunci sementara. Coba lagi dalam 15 menit');
    }

    const valid = await verifyPassword(input.password, account.password_hash);
    if (!valid) {
      await this.recordFailedLogin(account);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'NIP atau password salah');
    }
    if (!user.isActive) {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'Akun dinonaktifkan');
    }

    const { error: resetError } = await this.serviceClient
      .from('app_accounts')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('profile_id', user.id);
    if (resetError) {
      throw new AppError(500, 'LOGIN_FAILED', 'Login tidak dapat diproses');
    }
    return this.createSession(user);
  }

  async authenticate(accessToken: string): Promise<AuthUser> {
    const { data, error } = await this.serviceClient
      .from('app_sessions')
      .select('profile_id,expires_at,revoked_at')
      .eq('token_hash', tokenHash(accessToken))
      .maybeSingle();
    if (error || !data) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sesi tidak valid');
    }
    const session = SessionRowSchema.parse(data);
    if (session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sesi telah berakhir');
    }

    const { error: touchError } = await this.serviceClient
      .from('app_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('token_hash', tokenHash(accessToken));
    if (touchError) {
      throw new AppError(500, 'SESSION_UPDATE_FAILED', 'Sesi tidak dapat diperbarui');
    }
    return this.loadActiveProfile(session.profile_id);
  }

  async refresh(accessToken: string): Promise<SessionResult> {
    const user = await this.authenticate(accessToken);
    return {
      user,
      accessToken,
      refreshToken: '',
      expiresIn: SESSION_SECONDS,
    };
  }

  async changePassword(
    accessToken: string,
    _refreshToken: string,
    input: ChangePasswordRequest,
  ): Promise<SessionResult> {
    const user = await this.authenticate(accessToken);
    const { data, error } = await this.serviceClient
      .from('app_accounts')
      .select('profile_id,password_hash,failed_login_attempts,locked_until')
      .eq('profile_id', user.id)
      .single();
    if (error) {
      throw new AppError(500, 'PASSWORD_UPDATE_FAILED', 'Password tidak dapat diperbarui');
    }
    const account = AccountRowSchema.parse(data);
    if (!await verifyPassword(input.currentPassword, account.password_hash)) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Password saat ini salah');
    }

    const passwordHash = await hashPassword(input.newPassword);
    const changedAt = new Date().toISOString();
    const { error: updateError } = await this.serviceClient
      .from('app_accounts')
      .update({
        password_hash: passwordHash,
        password_changed_at: changedAt,
        failed_login_attempts: 0,
        locked_until: null,
      })
      .eq('profile_id', user.id);
    if (updateError) {
      throw new AppError(500, 'PASSWORD_UPDATE_FAILED', 'Password tidak dapat diperbarui');
    }

    await this.revokeSessions(user.id);
    const { error: auditError } = await this.serviceClient.from('audit_logs').insert({
      actor_id: user.id,
      action: 'PASSWORD_CHANGED',
      entity_type: 'profiles',
      entity_id: user.id,
      after_data: { passwordChangedAt: changedAt },
    });
    if (auditError) {
      throw new AppError(500, 'AUDIT_WRITE_FAILED', 'Audit tidak dapat dicatat');
    }
    return this.createSession(user);
  }

  async revokeSessions(profileId: string): Promise<void> {
    const { error } = await this.serviceClient
      .from('app_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .is('revoked_at', null);
    if (error) {
      throw new AppError(500, 'SESSION_REVOKE_FAILED', 'Sesi tidak dapat dicabut');
    }
  }

  async logout(accessToken?: string): Promise<void> {
    if (!accessToken) return;
    const { error } = await this.serviceClient
      .from('app_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', tokenHash(accessToken))
      .is('revoked_at', null);
    if (error) {
      throw new AppError(500, 'LOGOUT_FAILED', 'Logout tidak dapat diproses');
    }
  }
}

export async function bootstrapSuperAdmin(
  config: SupabaseAuthConfig,
  input: BootstrapSuperAdminInput,
): Promise<AuthUser> {
  const parsedConfig = SupabaseAuthConfigSchema.parse(config);
  const parsedInput = BootstrapInputSchema.parse(input);
  const nip = parsedInput.nip.toLowerCase();
  const client = createClient(parsedConfig.url, parsedConfig.secretKey, clientOptions());
  const fields = 'id,nip,full_name,role,is_active,profile_photo_mime_type,profile_photo_size_bytes,profile_photo_updated_at';
  const { data: existing, error: lookupError } = await client
    .from('profiles')
    .select(fields)
    .eq('nip', nip)
    .maybeSingle();
  if (lookupError) {
    throw new AppError(500, 'PROFILE_LOOKUP_FAILED', 'Profil tidak dapat dimuat');
  }

  if (existing) {
    const profile = parseProfile(existing);
    if (profile.role !== 'SUPER_ADMIN') {
      throw new AppError(409, 'NIP_ALREADY_EXISTS', 'NIP sudah digunakan');
    }
    const { data: account, error } = await client
      .from('app_accounts')
      .select('profile_id')
      .eq('profile_id', profile.id)
      .maybeSingle();
    if (error) throw new AppError(500, 'ACCOUNT_LOOKUP_FAILED', 'Akun tidak dapat diperiksa');
    if (!account) {
      const { error: insertError } = await client.from('app_accounts').insert({
        profile_id: profile.id,
        password_hash: await hashPassword(parsedInput.password),
      });
      if (insertError) throw new AppError(500, 'ACCOUNT_CREATE_FAILED', 'Akun tidak dapat dibuat');
    }
    return profile;
  }

  const profileId = randomUUID();
  const { data: created, error: profileError } = await client
    .from('profiles')
    .insert({
      id: profileId,
      nip,
      full_name: parsedInput.fullName,
      role: 'SUPER_ADMIN',
      is_active: true,
      must_change_password: false,
      temporary_password_expires_at: null,
    })
    .select(fields)
    .single();
  if (profileError || !created) {
    throw new AppError(500, 'SUPER_ADMIN_BOOTSTRAP_FAILED', 'Profil SuperAdmin tidak dapat dibuat');
  }

  const { error: accountError } = await client.from('app_accounts').insert({
    profile_id: profileId,
    password_hash: await hashPassword(parsedInput.password),
  });
  if (accountError) {
    await client.from('profiles').delete().eq('id', profileId);
    throw new AppError(500, 'SUPER_ADMIN_BOOTSTRAP_FAILED', 'Akun SuperAdmin tidak dapat dibuat');
  }

  const { error: auditError } = await client.from('audit_logs').insert({
    actor_id: profileId,
    action: 'SUPER_ADMIN_BOOTSTRAPPED',
    entity_type: 'profiles',
    entity_id: profileId,
    after_data: { nip, fullName: parsedInput.fullName, role: 'SUPER_ADMIN', isActive: true },
  });
  if (auditError) {
    await client.from('app_accounts').delete().eq('profile_id', profileId);
    await client.from('profiles').delete().eq('id', profileId);
    throw new AppError(500, 'SUPER_ADMIN_BOOTSTRAP_FAILED', 'Audit bootstrap SuperAdmin tidak dapat dicatat');
  }

  return parseProfile(created);
}
