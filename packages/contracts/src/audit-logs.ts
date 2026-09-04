import { z } from 'zod';

import { LocalDateSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';

const AuditFilterTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const ListAuditLogsQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    fromDate: LocalDateSchema.optional(),
    toDate: LocalDateSchema.optional(),
    actorId: z.uuid().optional(),
    action: AuditFilterTextSchema.optional(),
    entityType: AuditFilterTextSchema.optional(),
  })
  .refine(
    (value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate,
    { message: 'Tanggal awal tidak boleh setelah tanggal akhir', path: ['toDate'] },
  );
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuerySchema>;

export const AuditLogSchema = z.strictObject({
  id: z.uuid(),
  actorId: z.uuid(),
  actorNip: z.string().trim().min(1),
  actorFullName: z.string().trim().min(1),
  action: z.string().trim().min(1).max(100),
  entityType: z.string().trim().min(1).max(100),
  entityId: z.uuid().nullable(),
  beforeData: z.record(z.string(), z.unknown()).nullable(),
  afterData: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditLogListResponseSchema = z.strictObject({
  data: z.array(AuditLogSchema),
  pagination: PaginationSchema,
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
