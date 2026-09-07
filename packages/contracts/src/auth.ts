import { z } from 'zod';

export const UserRoleSchema = z.enum(['USER', 'SECURITY_GUARD', 'SUPER_ADMIN']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const NipSchema = z
  .string()
  .trim()
  .min(1, 'NIP wajib diisi')
  .max(64, 'NIP maksimal 64 karakter')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'NIP hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung',
  );

export const WhatsappNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Nomor WhatsApp wajib memakai format internasional E.164');

export const PasswordSchema = z
  .string()
  .length(8, 'Password wajib tepat 8 karakter')
  .regex(/^[A-Za-z0-9]+$/, 'Password hanya boleh berisi huruf dan angka')
  .regex(/[A-Z]/, 'Password wajib memiliki huruf kapital')
  .regex(/[a-z]/, 'Password wajib memiliki huruf kecil')
  .regex(/[0-9]/, 'Password wajib memiliki angka');

export const NewPasswordSchema = PasswordSchema;

export const LoginRequestSchema = z.strictObject({
  nip: NipSchema,
  password: PasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: PasswordSchema,
  newPassword: NewPasswordSchema,
});
export type ChangePasswordRequest = z.infer<
  typeof ChangePasswordRequestSchema
>;

export const ProfilePhotoMetadataSchema = z.strictObject({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(2 * 1024 * 1024),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ProfilePhotoMetadata = z.infer<typeof ProfilePhotoMetadataSchema>;

export const AuthUserSchema = z.strictObject({
  id: z.uuid(),
  nip: NipSchema,
  fullName: z.string().trim().min(1).max(200),
  whatsappNumber: WhatsappNumberSchema.nullable().optional(),
  role: UserRoleSchema,
  isActive: z.boolean(),
  photo: ProfilePhotoMetadataSchema.nullable().optional(),
  mustChangePassword: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.strictObject({
  user: AuthUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const LogoutResponseSchema = z.strictObject({
  success: z.literal(true),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
