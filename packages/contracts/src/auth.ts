import { z } from 'zod';

export const UserRoleSchema = z.enum(['USER', 'SUPER_ADMIN']);
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

const ExistingPasswordSchema = z
  .string()
  .min(1, 'Password wajib diisi')
  .max(128, 'Password maksimal 128 karakter');

export const NewPasswordSchema = z
  .string()
  .min(8, 'Password baru minimal 8 karakter')
  .max(128, 'Password baru maksimal 128 karakter');

export const LoginRequestSchema = z.strictObject({
  nip: NipSchema,
  password: ExistingPasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: ExistingPasswordSchema,
  newPassword: NewPasswordSchema,
});
export type ChangePasswordRequest = z.infer<
  typeof ChangePasswordRequestSchema
>;

export const AuthUserSchema = z.strictObject({
  id: z.uuid(),
  nip: NipSchema,
  fullName: z.string().trim().min(1).max(200),
  role: UserRoleSchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
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
