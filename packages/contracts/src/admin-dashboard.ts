import { z } from 'zod';
import { LocalDateSchema } from './settings.js';

const count = z.number().int().nonnegative();
const instant = z.iso.datetime({ offset: true });
export const AdminDashboardQuerySchema = z.strictObject({ workDate: LocalDateSchema.optional() });
export const DashboardDaySchema = z.strictObject({
  workDate: LocalDateSchema,
  state: z.enum(['WORKING', 'HOLIDAY', 'UNCONFIGURED', 'NOT_STARTED']),
  description: z.string(),
  provisional: z.boolean(),
  scheduled: count.nullable(),
  arrived: count.nullable(),
  notCheckedIn: count.nullable(),
  leave: count.nullable(),
  late: count.nullable(),
});
export const AdminDashboardResponseSchema = z.strictObject({
  workDate: LocalDateSchema,
  generatedAt: instant,
  day: DashboardDaySchema,
  window: z.strictObject({ openAt: instant, startAt: instant, closeAt: instant, observedUntil: instant }).nullable(),
  arrivals: z.array(z.strictObject({ at: instant, count, cumulative: count })),
  trend: z.array(DashboardDaySchema).length(7),
  guards: z.array(z.strictObject({
    teacherId: z.uuid(), name: z.string(), assignment: z.enum(['DAY', 'NIGHT', 'OFF', 'UNASSIGNED']),
    status: z.string(), startAt: instant.nullable(), endAt: instant.nullable(),
  })),
  rosterAvailable: z.boolean(),
});
export type DashboardDay = z.infer<typeof DashboardDaySchema>;
export type AdminDashboardResponse = z.infer<typeof AdminDashboardResponseSchema>;
