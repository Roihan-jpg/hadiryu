import { z } from 'zod';

import { LocalDateSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';
import { RequestAttachmentMetadataSchema } from './request-attachments.js';

export const LeaveTypeSchema = z.enum([
  'SICK',
  'OFFICIAL_DUTY',
  'FAMILY',
  'OTHER',
  'LATE_ARRIVAL',
  'MATERNITY_LEAVE',
]);
export type LeaveType = z.infer<typeof LeaveTypeSchema>;

export const LeaveStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);
export type LeaveStatus = z.infer<typeof LeaveStatusSchema>;

const ReasonSchema = z.string().trim().min(1, 'Alasan wajib diisi').max(1000);
const DecisionNoteSchema = z
  .string()
  .trim()
  .min(1, 'Catatan keputusan tidak boleh kosong')
  .max(1000);

const LeaveRequestBaseSchema = z.strictObject({
  id: z.uuid(),
  teacherId: z.uuid(),
  leaveDate: LocalDateSchema,
  leaveType: LeaveTypeSchema,
  reason: ReasonSchema,
  attachment: RequestAttachmentMetadataSchema.nullable().optional(),
  status: LeaveStatusSchema,
  decisionNote: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  fullLeaveEndDate: LocalDateSchema.nullable().optional(),
  earlyDepartureStartDate: LocalDateSchema.nullable().optional(),
  earlyDepartureEndDate: LocalDateSchema.nullable().optional(),
});

function validateDecisionState(
  value: z.infer<typeof LeaveRequestBaseSchema>,
  context: z.RefinementCtx,
): void {
  const isDecided = value.status === 'APPROVED' || value.status === 'REJECTED';
  const hasDecisionMetadata = value.decidedBy !== null && value.decidedAt !== null;
  if (isDecided !== hasDecisionMetadata) {
    context.addIssue({
      code: 'custom',
      message: 'Metadata keputusan tidak sesuai dengan status izin',
      path: ['status'],
    });
  }
}

export const LeaveRequestSchema = LeaveRequestBaseSchema.superRefine(
  validateDecisionState,
);
export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

const StandardLeaveTypeSchema = z.enum([
  'SICK',
  'OFFICIAL_DUTY',
  'FAMILY',
  'OTHER',
  'LATE_ARRIVAL',
]);

export const CreateLeaveRequestSchema = z.discriminatedUnion('leaveType', [
  z.strictObject({
    leaveDate: LocalDateSchema,
    leaveType: StandardLeaveTypeSchema,
    reason: ReasonSchema,
  }),
  z.strictObject({
    leaveType: z.literal('MATERNITY_LEAVE'),
    reason: ReasonSchema,
  }),
]);
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequestSchema>;

export const ListLeaveRequestsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: LeaveStatusSchema.optional(),
});
export type ListLeaveRequestsQuery = z.infer<typeof ListLeaveRequestsQuerySchema>;

export const AdminLeaveRequestSchema = LeaveRequestBaseSchema.extend({
  teacherNip: z.string().min(1),
  teacherFullName: z.string().min(1),
  teacherWhatsappNumber: z.string().nullable().optional(),
}).superRefine(validateDecisionState);
export type AdminLeaveRequest = z.infer<typeof AdminLeaveRequestSchema>;

export const AdminLeaveRequestDetailResponseSchema = z.strictObject({
  leaveRequest: AdminLeaveRequestSchema,
});
export type AdminLeaveRequestDetailResponse = z.infer<
  typeof AdminLeaveRequestDetailResponseSchema
>;

export const ListAdminLeaveRequestsQuerySchema = ListLeaveRequestsQuerySchema.extend({
  leaveDate: LocalDateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ListAdminLeaveRequestsQuery = z.infer<
  typeof ListAdminLeaveRequestsQuerySchema
>;

export const DecideLeaveRequestSchema = z.strictObject({
  decisionNote: DecisionNoteSchema.optional(),
});
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequestSchema>;

export const LeaveRequestResponseSchema = z.strictObject({
  leaveRequest: LeaveRequestSchema,
});
export type LeaveRequestResponse = z.infer<typeof LeaveRequestResponseSchema>;

export const LeaveRequestListResponseSchema = z.strictObject({
  data: z.array(LeaveRequestSchema),
  pagination: PaginationSchema,
});
export type LeaveRequestListResponse = z.infer<typeof LeaveRequestListResponseSchema>;

export const AdminLeaveRequestListResponseSchema = z.strictObject({
  data: z.array(AdminLeaveRequestSchema),
  pagination: PaginationSchema,
});
export type AdminLeaveRequestListResponse = z.infer<
  typeof AdminLeaveRequestListResponseSchema
>;
