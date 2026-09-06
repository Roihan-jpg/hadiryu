import { z } from 'zod';

import { AuthUserSchema, WhatsappNumberSchema } from './auth.js';

export const UpdateOwnProfileRequestSchema = z.strictObject({
  fullName: z.string().trim().min(1, 'Nama lengkap wajib diisi').max(200),
  whatsappNumber: WhatsappNumberSchema.nullable().optional(),
});
export type UpdateOwnProfileRequest = z.infer<typeof UpdateOwnProfileRequestSchema>;

export const OwnProfileResponseSchema = z.strictObject({
  profile: AuthUserSchema,
});
export type OwnProfileResponse = z.infer<typeof OwnProfileResponseSchema>;

export const ProfilePhotoResponseSchema = z.strictObject({
  profile: AuthUserSchema,
});
export type ProfilePhotoResponse = z.infer<typeof ProfilePhotoResponseSchema>;
