import { z } from 'zod';

import { LeaveTypeSchema } from './leave-requests.js';
import { LocalDateSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';
import { StaffRoleSchema } from './teachers.js';
import { ScheduleTypeSchema } from './settings.js';

export const AdminAttendanceStatusSchema = z.enum([
  'PRESENT',
  'LATE',
  'NOT_PRESENT',
  'INCOMPLETE',
  'LEAVE',
  'OFF',
]);
export type AdminAttendanceStatus = z.infer<
  typeof AdminAttendanceStatusSchema
>;

export const AttendanceAdminNoteSchema = z.strictObject({
  id: z.uuid(),
  attendanceId: z.uuid(),
  note: z.string().trim().min(1).max(2000),
  createdBy: z.uuid(),
  createdByFullName: z.string().trim().min(1).max(200),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AttendanceAdminNote = z.infer<typeof AttendanceAdminNoteSchema>;

export const AdminAttendanceRecordSchema = z.strictObject({
  teacherId: z.uuid(),
  teacherNip: z.string().trim().min(1),
  teacherFullName: z.string().trim().min(1).max(200),
  role: StaffRoleSchema.optional(),
  scheduleType: ScheduleTypeSchema.nullable().optional(),
  workDate: LocalDateSchema,
  status: AdminAttendanceStatusSchema,
  attendanceId: z.uuid().nullable(),
  checkInAt: z.iso.datetime({ offset: true }).nullable(),
  checkOutAt: z.iso.datetime({ offset: true }).nullable(),
  workedMinutes: z.number().int().nonnegative().nullable(),
  workDeficitMinutes: z.number().int().nonnegative().nullable(),
  arrivalLateMinutes: z.number().int().nonnegative().nullable(),
  leaveType: LeaveTypeSchema.nullable(),
  notes: z.array(AttendanceAdminNoteSchema),
});
export type AdminAttendanceRecord = z.infer<
  typeof AdminAttendanceRecordSchema
>;

export const ListAdminAttendanceQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  workDate: LocalDateSchema.optional(),
  status: AdminAttendanceStatusSchema.optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(
      /^[\p{L}\p{N} ._-]*$/u,
      'Pencarian hanya boleh berisi huruf, angka, spasi, titik, garis bawah, atau tanda hubung',
    )
    .optional(),
});
export type ListAdminAttendanceQuery = z.infer<
  typeof ListAdminAttendanceQuerySchema
>;

export const AdminAttendanceSummarySchema = z
  .strictObject({
    workDate: LocalDateSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    present: z.number().int().nonnegative(),
    late: z.number().int().nonnegative(),
    notPresent: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
    leave: z.number().int().nonnegative(),
    off: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .superRefine((summary, context) => {
    const expectedTotal =
      summary.present +
      summary.late +
      summary.notPresent +
      summary.incomplete +
      summary.leave +
      summary.off;
    if (summary.total !== expectedTotal) {
      context.addIssue({
        code: 'custom',
        message: 'Total ringkasan wajib sama dengan jumlah seluruh status',
        path: ['total'],
      });
    }
  });
export type AdminAttendanceSummary = z.infer<
  typeof AdminAttendanceSummarySchema
>;

export const AdminAttendanceListResponseSchema = z.strictObject({
  summary: AdminAttendanceSummarySchema,
  data: z.array(AdminAttendanceRecordSchema),
  pagination: PaginationSchema,
});
export type AdminAttendanceListResponse = z.infer<
  typeof AdminAttendanceListResponseSchema
>;

export const CreateAttendanceAdminNoteSchema = z.strictObject({
  note: z.string().trim().min(1, 'Catatan wajib diisi').max(2000),
});
export type CreateAttendanceAdminNote = z.infer<
  typeof CreateAttendanceAdminNoteSchema
>;

export const AttendanceAdminNoteResponseSchema = z.strictObject({
  note: AttendanceAdminNoteSchema,
});
export type AttendanceAdminNoteResponse = z.infer<
  typeof AttendanceAdminNoteResponseSchema
>;
