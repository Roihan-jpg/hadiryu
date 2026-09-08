import { randomUUID } from 'node:crypto';

import {
  AuthUserSchema,
  UpdateOwnProfileRequestSchema,
  type AuthUser,
  type ProfilePhotoMetadata,
  type UpdateOwnProfileRequest,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { AppError, createSessionGuard, type AuthService } from './auth.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

const ProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: z.string(),
  full_name: z.string(),
  whatsapp_number: z.string().nullable(),
  role: z.enum(['USER', 'SECURITY_GUARD', 'SUPER_ADMIN']),
  is_active: z.boolean(),
  profile_photo_storage_path: z.string().nullable(),
  profile_photo_mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).nullable(),
  profile_photo_size_bytes: z.number().int().positive().nullable(),
  profile_photo_updated_at: z.string().nullable(),
});

const PROFILE_FIELDS =
  'id,nip,full_name,whatsapp_number,role,is_active,profile_photo_storage_path,profile_photo_mime_type,profile_photo_size_bytes,profile_photo_updated_at';

export interface UploadedProfilePhoto {
  buffer: Buffer;
  mimeType: ProfilePhotoMetadata['mimeType'];
  sizeBytes: number;
}

export interface ProfileService {
  updateProfile(user: AuthUser, input: UpdateOwnProfileRequest): Promise<AuthUser>;
  uploadPhoto(user: AuthUser, photo: UploadedProfilePhoto): Promise<AuthUser>;
  downloadPhoto(user: AuthUser): Promise<{ data: Buffer; mimeType: string; sizeBytes: number }>;
  deletePhoto(user: AuthUser): Promise<AuthUser>;
}

function hasMagicBytes(buffer: Buffer, mimeType: UploadedProfilePhoto['mimeType']): boolean {
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  return buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function validateProfilePhoto(file: Express.Multer.File | undefined): UploadedProfilePhoto {
  if (!file) throw new AppError(400, 'PHOTO_REQUIRED', 'Foto profil wajib dipilih');
  const mime = z.enum(['image/jpeg', 'image/png', 'image/webp']).safeParse(file.mimetype);
  if (!mime.success || !hasMagicBytes(file.buffer, mime.data)) {
    throw new AppError(400, 'PHOTO_TYPE_INVALID', 'Foto harus berupa JPEG, PNG, atau WebP yang valid');
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new AppError(413, 'PHOTO_TOO_LARGE', 'Foto profil maksimal 2 MB');
  }
  return { buffer: file.buffer, mimeType: mime.data, sizeBytes: file.size };
}

function toUser(value: unknown): AuthUser {
  const row = ProfileRowSchema.parse(value);
  const hasPhoto = row.profile_photo_mime_type !== null &&
    row.profile_photo_size_bytes !== null && row.profile_photo_updated_at !== null;
  return AuthUserSchema.parse({
    id: row.id,
    nip: row.nip,
    fullName: row.full_name,
    whatsappNumber: row.whatsapp_number,
    role: row.role,
    isActive: row.is_active,
    mustChangePassword: false,
    photo: hasPhoto ? {
      mimeType: row.profile_photo_mime_type,
      sizeBytes: row.profile_photo_size_bytes,
      updatedAt: new Date(row.profile_photo_updated_at!).toISOString(),
    } : null,
  });
}

function extension(mimeType: UploadedProfilePhoto['mimeType']): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function clientOptions() {
  return { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
}

export class SupabaseProfileService implements ProfileService {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
  }

  private async load(profileId: string): Promise<z.infer<typeof ProfileRowSchema>> {
    const { data, error } = await this.client.from('profiles').select(PROFILE_FIELDS)
      .eq('id', profileId).maybeSingle();
    if (error) throw new AppError(500, 'PROFILE_LOOKUP_FAILED', 'Profil tidak dapat dimuat');
    if (!data) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Profil tidak ditemukan');
    return ProfileRowSchema.parse(data);
  }

  private async audit(userId: string, action: string, beforeData: object, afterData: object): Promise<void> {
    const { error } = await this.client.from('audit_logs').insert({
      actor_id: userId,
      action,
      entity_type: 'profiles',
      entity_id: userId,
      before_data: beforeData,
      after_data: afterData,
    });
    if (error) throw new AppError(500, 'AUDIT_WRITE_FAILED', 'Audit profil tidak dapat dicatat');
  }

  async updateProfile(user: AuthUser, input: UpdateOwnProfileRequest): Promise<AuthUser> {
    const before = await this.load(user.id);
    const whatsappNumber = input.whatsappNumber === undefined ? before.whatsapp_number : input.whatsappNumber;
    if (before.full_name === input.fullName && before.whatsapp_number === whatsappNumber) return toUser(before);
    const { data, error } = await this.client.from('profiles')
      .update({ full_name: input.fullName, whatsapp_number: whatsappNumber }).eq('id', user.id).select(PROFILE_FIELDS).single();
    if (error || !data) throw new AppError(500, 'PROFILE_UPDATE_FAILED', 'Profil tidak dapat diperbarui');
    try {
      await this.audit(user.id, 'PROFILE_UPDATED',
        { fullName: before.full_name, whatsappNumber: before.whatsapp_number }, { fullName: input.fullName, whatsappNumber });
    } catch (auditError) {
      await this.client.from('profiles').update({ full_name: before.full_name, whatsapp_number: before.whatsapp_number }).eq('id', user.id);
      throw auditError;
    }
    return toUser(data);
  }

  async uploadPhoto(user: AuthUser, photo: UploadedProfilePhoto): Promise<AuthUser> {
    const before = await this.load(user.id);
    const storagePath = `${user.id}/${randomUUID()}.${extension(photo.mimeType)}`;
    const { error: uploadError } = await this.client.storage.from('profile-photos')
      .upload(storagePath, photo.buffer, { contentType: photo.mimeType, upsert: false });
    if (uploadError) throw new AppError(500, 'PHOTO_UPLOAD_FAILED', 'Foto profil tidak dapat disimpan');

    const updatedAt = new Date().toISOString();
    const { data, error } = await this.client.from('profiles').update({
      profile_photo_storage_path: storagePath,
      profile_photo_mime_type: photo.mimeType,
      profile_photo_size_bytes: photo.sizeBytes,
      profile_photo_updated_at: updatedAt,
    }).eq('id', user.id).select(PROFILE_FIELDS).single();
    if (error || !data) {
      await this.client.storage.from('profile-photos').remove([storagePath]);
      throw new AppError(500, 'PHOTO_UPDATE_FAILED', 'Foto profil tidak dapat diperbarui');
    }

    try {
      await this.audit(user.id, 'PROFILE_PHOTO_UPDATED',
        { hasPhoto: before.profile_photo_storage_path !== null }, { hasPhoto: true, updatedAt });
    } catch (auditError) {
      await this.client.from('profiles').update({
        profile_photo_storage_path: before.profile_photo_storage_path,
        profile_photo_mime_type: before.profile_photo_mime_type,
        profile_photo_size_bytes: before.profile_photo_size_bytes,
        profile_photo_updated_at: before.profile_photo_updated_at,
      }).eq('id', user.id);
      await this.client.storage.from('profile-photos').remove([storagePath]);
      throw auditError;
    }
    if (before.profile_photo_storage_path) {
      await this.client.storage.from('profile-photos').remove([before.profile_photo_storage_path]);
    }
    return toUser(data);
  }

  async downloadPhoto(user: AuthUser): Promise<{ data: Buffer; mimeType: string; sizeBytes: number }> {
    const profile = await this.load(user.id);
    if (!profile.profile_photo_storage_path || !profile.profile_photo_mime_type || !profile.profile_photo_size_bytes) {
      throw new AppError(404, 'PHOTO_NOT_FOUND', 'Foto profil belum tersedia');
    }
    const { data, error } = await this.client.storage.from('profile-photos')
      .download(profile.profile_photo_storage_path);
    if (error) throw new AppError(500, 'PHOTO_DOWNLOAD_FAILED', 'Foto profil tidak dapat dimuat');
    return {
      data: Buffer.from(await data.arrayBuffer()),
      mimeType: profile.profile_photo_mime_type,
      sizeBytes: profile.profile_photo_size_bytes,
    };
  }

  async deletePhoto(user: AuthUser): Promise<AuthUser> {
    const before = await this.load(user.id);
    if (!before.profile_photo_storage_path) return toUser(before);
    const { data, error } = await this.client.from('profiles').update({
      profile_photo_storage_path: null,
      profile_photo_mime_type: null,
      profile_photo_size_bytes: null,
      profile_photo_updated_at: null,
    }).eq('id', user.id).select(PROFILE_FIELDS).single();
    if (error || !data) throw new AppError(500, 'PHOTO_DELETE_FAILED', 'Foto profil tidak dapat dihapus');
    try {
      await this.audit(user.id, 'PROFILE_PHOTO_DELETED', { hasPhoto: true }, { hasPhoto: false });
    } catch (auditError) {
      await this.client.from('profiles').update({
        profile_photo_storage_path: before.profile_photo_storage_path,
        profile_photo_mime_type: before.profile_photo_mime_type,
        profile_photo_size_bytes: before.profile_photo_size_bytes,
        profile_photo_updated_at: before.profile_photo_updated_at,
      }).eq('id', user.id);
      throw auditError;
    }
    await this.client.storage.from('profile-photos').remove([before.profile_photo_storage_path]);
    return toUser(data);
  }
}

const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_PHOTO_MAX_BYTES, files: 1, fields: 0 },
}).single('photo');

function parsePhoto(request: Request, response: Response, next: NextFunction): void {
  profilePhotoUpload(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 'PHOTO_TOO_LARGE', 'Foto profil maksimal 2 MB'));
    } else if (error) {
      next(new AppError(400, 'PHOTO_INVALID', 'Foto profil tidak dapat diproses'));
    } else next();
  });
}

function currentUser(response: Response): AuthUser {
  const user = response.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user;
}

export function registerProfileRoutes(
  app: Express,
  authService: AuthService,
  profileService: ProfileService,
): void {
  const guard = createSessionGuard(authService);
  app.patch('/api/profile', guard, async (request, response, next) => {
    try {
      const parsed = UpdateOwnProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Data profil tidak valid', parsed.error.flatten());
      response.status(200).json({ profile: await profileService.updateProfile(currentUser(response), parsed.data) });
    } catch (error) { next(error); }
  });
  app.post('/api/profile/photo', guard, parsePhoto, async (request, response, next) => {
    try {
      response.status(200).json({
        profile: await profileService.uploadPhoto(currentUser(response), validateProfilePhoto(request.file)),
      });
    } catch (error) { next(error); }
  });
  app.get('/api/profile/photo', guard, async (_request, response, next) => {
    try {
      const result = await profileService.downloadPhoto(currentUser(response));
      response.set({
        'Content-Type': result.mimeType,
        'Content-Length': String(result.sizeBytes),
        'Cache-Control': 'private, no-store',
      });
      response.status(200).send(result.data);
    } catch (error) { next(error); }
  });
  app.delete('/api/profile/photo', guard, async (_request, response, next) => {
    try {
      response.status(200).json({ profile: await profileService.deletePhoto(currentUser(response)) });
    } catch (error) { next(error); }
  });
}
