import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  RequestAttachmentMetadataSchema,
  RequestAttachmentMimeTypeSchema,
  type AuthUser,
  type RequestAttachmentMetadata,
  type RequestAttachmentMimeType,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { AppError, createSessionGuard, type AuthService } from './auth.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

export const REQUEST_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export interface UploadedRequestAttachment extends RequestAttachmentMetadata {
  buffer: Buffer;
}

export interface StoredRequestAttachment extends RequestAttachmentMetadata {
  storagePath: string;
}

export interface RequestAttachmentStorage {
  upload(
    teacherId: string,
    requestType: 'leave' | 'early-departure',
    attachment: UploadedRequestAttachment,
  ): Promise<StoredRequestAttachment>;
  remove(storagePath: string): Promise<void>;
}

function hasMagicBytes(buffer: Buffer, mimeType: RequestAttachmentMimeType): boolean {
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function validateUploadedAttachment(
  file: Express.Multer.File | undefined,
): UploadedRequestAttachment | undefined {
  if (!file) return undefined;
  const mime = RequestAttachmentMimeTypeSchema.safeParse(file.mimetype);
  if (!mime.success || !hasMagicBytes(file.buffer, mime.data)) {
    throw new AppError(
      400,
      'ATTACHMENT_TYPE_INVALID',
      'Lampiran harus berupa PDF, JPEG, atau PNG yang valid',
    );
  }
  const originalName = [...path.basename(file.originalname)]
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .trim();
  const metadata = RequestAttachmentMetadataSchema.parse({
    originalName,
    mimeType: mime.data,
    sizeBytes: file.size,
  });
  return { ...metadata, buffer: file.buffer };
}

export const requestAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: REQUEST_ATTACHMENT_MAX_BYTES, files: 1, fields: 10 },
}).single('attachment');

export function parseOptionalAttachment(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!request.is('multipart/form-data')) {
    next();
    return;
  }
  requestAttachmentUpload(request, response, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      next(new AppError(413, 'ATTACHMENT_TOO_LARGE', 'Lampiran maksimal 5 MB'));
      return;
    }
    if (error) {
      next(new AppError(400, 'ATTACHMENT_INVALID', 'Lampiran tidak dapat diproses'));
      return;
    }
    next();
  });
}

export function multipartPayload(request: Request): unknown {
  if (!request.is('multipart/form-data')) return request.body;
  if (typeof request.body?.['payload'] !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field payload JSON wajib diisi');
  }
  try {
    return JSON.parse(request.body['payload']);
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Field payload harus berupa JSON valid');
  }
}

function extension(mimeType: RequestAttachmentMimeType): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  return 'jpg';
}

export class SupabaseRequestAttachmentService implements RequestAttachmentStorage {
  private readonly client: SupabaseClient;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async upload(
    teacherId: string,
    requestType: 'leave' | 'early-departure',
    attachment: UploadedRequestAttachment,
  ): Promise<StoredRequestAttachment> {
    const storagePath = `${teacherId}/${requestType}/${randomUUID()}.${extension(attachment.mimeType)}`;
    const { error } = await this.client.storage
      .from('request-attachments')
      .upload(storagePath, attachment.buffer, {
        contentType: attachment.mimeType,
        upsert: false,
      });
    if (error) {
      throw new AppError(500, 'ATTACHMENT_UPLOAD_FAILED', 'Lampiran tidak dapat disimpan');
    }
    return {
      storagePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    };
  }

  async remove(storagePath: string): Promise<void> {
    await this.client.storage.from('request-attachments').remove([storagePath]);
  }

  async download(
    requestType: 'leave' | 'early-departure',
    requestId: string,
    user: AuthUser,
  ): Promise<{ data: Buffer; metadata: RequestAttachmentMetadata }> {
    const table = requestType === 'leave' ? 'leave_requests' : 'early_departure_requests';
    const { data: row, error } = await this.client
      .from(table)
      .select('teacher_id,attachment_storage_path,attachment_original_name,attachment_mime_type,attachment_size_bytes')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw new AppError(500, 'ATTACHMENT_LOOKUP_FAILED', 'Lampiran tidak dapat dimuat');
    if (!row || (user.role !== 'SUPER_ADMIN' && row.teacher_id !== user.id)) {
      throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Lampiran tidak ditemukan');
    }
    if (!row.attachment_storage_path) {
      throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Pengajuan tidak memiliki lampiran');
    }
    const metadata = RequestAttachmentMetadataSchema.parse({
      originalName: row.attachment_original_name,
      mimeType: row.attachment_mime_type,
      sizeBytes: row.attachment_size_bytes,
    });
    const { data, error: downloadError } = await this.client.storage
      .from('request-attachments')
      .download(row.attachment_storage_path);
    if (downloadError) throw new AppError(500, 'ATTACHMENT_DOWNLOAD_FAILED', 'Lampiran tidak dapat diunduh');
    return { data: Buffer.from(await data.arrayBuffer()), metadata };
  }
}

function authUser(request: Request): AuthUser {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user;
}

export function registerRequestAttachmentRoutes(
  app: Express,
  authService: AuthService,
  service: SupabaseRequestAttachmentService,
): void {
  const guard = createSessionGuard(authService);
  for (const [pathName, requestType] of [
    ['/api/leave-requests/:id/attachment', 'leave'],
    ['/api/early-departure-requests/:id/attachment', 'early-departure'],
  ] as const) {
    app.get(pathName, guard, async (request, response, next) => {
      try {
        const parsedId = z.uuid().safeParse(request.params['id']);
        if (!parsedId.success) throw new AppError(400, 'VALIDATION_ERROR', 'ID pengajuan tidak valid');
        const requestId = parsedId.data;
        const result = await service.download(requestType, requestId, authUser(request));
        response.set({
          'Content-Type': result.metadata.mimeType,
          'Content-Length': String(result.metadata.sizeBytes),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.originalName)}`,
          'Cache-Control': 'private, no-store',
        });
        response.status(200).send(result.data);
      } catch (error) { next(error); }
    });
  }
}
