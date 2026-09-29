import { z } from 'zod';

import { GenderSchema, NewPasswordSchema, NipSchema, WhatsappNumberSchema } from './auth.js';

export const StaffRoleSchema = z.enum(['USER', 'SECURITY_GUARD']);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

const BooleanQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);

export const TeacherSchema = z.strictObject({
  id: z.uuid(),
  nip: NipSchema,
  fullName: z.string().trim().min(1, 'Nama lengkap wajib diisi').max(200),
  whatsappNumber: WhatsappNumberSchema.nullable(),
  gender: GenderSchema.nullable().optional(),
  role: StaffRoleSchema.optional(),
  isActive: z.boolean(),
  mustChangePassword: z.boolean().optional(),
  temporaryPasswordExpiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Teacher = z.infer<typeof TeacherSchema>;

export const ListTeachersQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(200)
    .regex(
      /^[\p{L}\p{N} ._-]*$/u,
      'Pencarian hanya boleh berisi huruf, angka, spasi, titik, garis bawah, atau tanda hubung',
    )
    .optional(),
  isActive: BooleanQuerySchema.optional(),
  mustChangePassword: BooleanQuerySchema.optional(),
  role: StaffRoleSchema.optional(),
});
export type ListTeachersQuery = z.infer<typeof ListTeachersQuerySchema>;

export const CreateTeacherRequestSchema = z.strictObject({
  nip: NipSchema,
  fullName: z.string().trim().min(1, 'Nama lengkap wajib diisi').max(200),
  initialPassword: NewPasswordSchema,
  whatsappNumber: WhatsappNumberSchema.nullable().optional(),
  gender: GenderSchema,
  role: StaffRoleSchema.optional(),
});
export type CreateTeacherRequest = z.infer<
  typeof CreateTeacherRequestSchema
>;

export const UpdateTeacherRequestSchema = z
  .strictObject({
    nip: NipSchema.optional(),
    fullName: z
      .string()
      .trim()
      .min(1, 'Nama lengkap wajib diisi')
      .max(200)
      .optional(),
    whatsappNumber: WhatsappNumberSchema.nullable().optional(),
    gender: GenderSchema.optional(),
  })
  .refine((input) =>
    input.nip !== undefined ||
    input.fullName !== undefined ||
    input.whatsappNumber !== undefined ||
    input.gender !== undefined, {
    message: 'Minimal satu perubahan profil wajib diisi',
  });
export type UpdateTeacherRequest = z.infer<
  typeof UpdateTeacherRequestSchema
>;

export const ResetTeacherPasswordRequestSchema = z.strictObject({});
export type ResetTeacherPasswordRequest = z.infer<
  typeof ResetTeacherPasswordRequestSchema
>;

export const PasswordResetResponseSchema = z.strictObject({
  teacher: TeacherSchema,
  newPassword: NewPasswordSchema,
});
export type PasswordResetResult = z.infer<typeof PasswordResetResponseSchema>;

export const PaginationSchema = z.strictObject({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const TeacherListResponseSchema = z.strictObject({
  data: z.array(TeacherSchema),
  pagination: PaginationSchema,
});
export type TeacherListResponse = z.infer<
  typeof TeacherListResponseSchema
>;

export const TeacherResponseSchema = z.strictObject({
  teacher: TeacherSchema,
});
export type TeacherResponse = z.infer<typeof TeacherResponseSchema>;
