import { z } from 'zod';

import { LocationInputSchema } from './attendance.js';
import { LocalDateSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';
import { RequestAttachmentMetadataSchema } from './request-attachments.js';

export const EarlyDepartureStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type EarlyDepartureStatus = z.infer<typeof EarlyDepartureStatusSchema>;

const ReasonSchema = z.string().trim().min(1, 'Alasan wajib diisi').max(1000);
const DecisionNoteSchema = z
  .string()
  .trim()
  .min(1, 'Catatan keputusan tidak boleh kosong')
  .max(1000);

const EarlyDepartureRequestBaseSchema = z.strictObject({
  id: z.uuid(),
  attendanceId: z.uuid(),
  teacherId: z.uuid(),
  workDate: LocalDateSchema,
  requestedAt: z.iso.datetime({ offset: true }),
  reason: ReasonSchema,
  attachment: RequestAttachmentMetadataSchema.nullable().optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
  distanceMeters: z.number().finite().nonnegative(),
  boundaryClearanceMeters: z.number().finite().nonnegative().nullable().optional(),
  status: EarlyDepartureStatusSchema,
  decisionNote: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

function validateDecisionState(
  value: z.infer<typeof EarlyDepartureRequestBaseSchema>,
  context: z.RefinementCtx,
): void {
  const decided = value.status === 'APPROVED' || value.status === 'REJECTED';
  const hasMetadata = value.decidedBy !== null && value.decidedAt !== null;
  if (decided !== hasMetadata) {
    context.addIssue({
      code: 'custom',
      message: 'Metadata keputusan tidak sesuai dengan status pulang awal',
      path: ['status'],
    });
  }
}

export const EarlyDepartureRequestSchema =
  EarlyDepartureRequestBaseSchema.superRefine(validateDecisionState);
export type EarlyDepartureRequest = z.infer<
  typeof EarlyDepartureRequestSchema
>;

export const CreateEarlyDepartureRequestSchema = z.strictObject({
  reason: ReasonSchema,
  ...LocationInputSchema.shape,
});
export type CreateEarlyDepartureRequest = z.infer<
  typeof CreateEarlyDepartureRequestSchema
>;

export const ListEarlyDepartureRequestsQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: EarlyDepartureStatusSchema.optional(),
});
export type ListEarlyDepartureRequestsQuery = z.infer<
  typeof ListEarlyDepartureRequestsQuerySchema
>;

export const AdminEarlyDepartureRequestSchema =
  EarlyDepartureRequestBaseSchema.extend({
    teacherNip: z.string().trim().min(1),
    teacherFullName: z.string().trim().min(1),
    teacherWhatsappNumber: z.string().nullable().optional(),
  }).superRefine(validateDecisionState);
export type AdminEarlyDepartureRequest = z.infer<
  typeof AdminEarlyDepartureRequestSchema
>;

export const AttendanceTimelineEventSchema = z.strictObject({
  type: z.enum(['CHECK_IN', 'REQUESTED', 'CHECKOUT', 'DECIDED']),
  timestamp: z.iso.datetime({ offset: true }),
  label: z.string().trim().min(1).max(200),
});
export type AttendanceTimelineEvent = z.infer<typeof AttendanceTimelineEventSchema>;

export const AdminEarlyDepartureRequestDetailResponseSchema = z.strictObject({
  earlyDepartureRequest: AdminEarlyDepartureRequestSchema,
  attendanceTimeline: z.array(AttendanceTimelineEventSchema),
});
export type AdminEarlyDepartureRequestDetailResponse = z.infer<
  typeof AdminEarlyDepartureRequestDetailResponseSchema
>;

export const ListAdminEarlyDepartureRequestsQuerySchema =
  ListEarlyDepartureRequestsQuerySchema.extend({
    workDate: LocalDateSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
  });
export type ListAdminEarlyDepartureRequestsQuery = z.infer<
  typeof ListAdminEarlyDepartureRequestsQuerySchema
>;

export const DecideEarlyDepartureRequestSchema = z.strictObject({
  decisionNote: DecisionNoteSchema.optional(),
});
export type DecideEarlyDepartureRequest = z.infer<
  typeof DecideEarlyDepartureRequestSchema
>;

export const EarlyDepartureRequestResponseSchema = z.strictObject({
  earlyDepartureRequest: EarlyDepartureRequestSchema,
});
export type EarlyDepartureRequestResponse = z.infer<
  typeof EarlyDepartureRequestResponseSchema
>;

export const EarlyDepartureRequestListResponseSchema = z.strictObject({
  data: z.array(EarlyDepartureRequestSchema),
  pagination: PaginationSchema,
});
export type EarlyDepartureRequestListResponse = z.infer<
  typeof EarlyDepartureRequestListResponseSchema
>;

export const AdminEarlyDepartureRequestListResponseSchema = z.strictObject({
  data: z.array(AdminEarlyDepartureRequestSchema),
  pagination: PaginationSchema,
});
export type AdminEarlyDepartureRequestListResponse = z.infer<
  typeof AdminEarlyDepartureRequestListResponseSchema
>;
