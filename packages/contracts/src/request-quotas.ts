import { z } from 'zod';

export const CalendarMonthSchema = z.string().regex(
  /^\d{4}-(?:0[1-9]|1[0-2])$/,
  'Bulan wajib memakai format YYYY-MM',
);

export const RequestQuotaQuerySchema = z.strictObject({
  month: CalendarMonthSchema,
});
export type RequestQuotaQuery = z.infer<typeof RequestQuotaQuerySchema>;

export const RequestQuotaUsageSchema = z.strictObject({
  limit: z.literal(2),
  used: z.number().int().min(0).max(2),
  remaining: z.number().int().min(0).max(2),
}).refine((quota) => quota.used + quota.remaining === quota.limit, {
  message: 'Jumlah kuota terpakai dan tersisa harus sama dengan batas',
});
export type RequestQuotaUsage = z.infer<typeof RequestQuotaUsageSchema>;

export const RequestQuotaResponseSchema = z.strictObject({
  month: CalendarMonthSchema,
  lateArrival: RequestQuotaUsageSchema,
  earlyDeparture: RequestQuotaUsageSchema,
});
export type RequestQuotaResponse = z.infer<typeof RequestQuotaResponseSchema>;
