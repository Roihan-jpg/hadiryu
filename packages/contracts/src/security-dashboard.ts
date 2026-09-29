import { z } from 'zod';

import { AttendanceRecordSchema } from './attendance.js';
import { LocalDateSchema, ScheduleTypeSchema } from './settings.js';

export const SecurityDutyStatusSchema = z.enum([
  'DAY', 'NIGHT', 'OFF', 'UNASSIGNED', 'CONFIGURATION_ERROR',
]);
export type SecurityDutyStatus = z.infer<typeof SecurityDutyStatusSchema>;

const ShiftBoundariesSchema = z.strictObject({
  checkInOpenAt: z.iso.datetime({ offset: true }),
  workStartAt: z.iso.datetime({ offset: true }),
  checkInCloseAt: z.iso.datetime({ offset: true }),
  checkoutOpenAt: z.iso.datetime({ offset: true }),
  workEndAt: z.iso.datetime({ offset: true }),
  checkoutCloseAt: z.iso.datetime({ offset: true }),
});

export const SecurityDutySchema = z.strictObject({
  workDate: LocalDateSchema,
  rotationDay: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  status: SecurityDutyStatusSchema,
  scheduleType: ScheduleTypeSchema.nullable(),
  targetMinutes: z.number().int().positive().nullable(),
  boundaries: ShiftBoundariesSchema.nullable(),
});
export type SecurityDuty = z.infer<typeof SecurityDutySchema>;

export const SecurityGuardDashboardResponseSchema = z.strictObject({
  serverNow: z.iso.datetime({ offset: true }),
  calendarDate: LocalDateSchema,
  currentDuty: SecurityDutySchema,
  activeDuty: SecurityDutySchema.nullable(),
  activeAttendance: AttendanceRecordSchema.nullable(),
  latestAttendance: AttendanceRecordSchema.nullable(),
  nextWorkingDuty: SecurityDutySchema.nullable(),
  locationRequirement: z.strictObject({ maxAccuracyMeters: z.number().int().min(5).max(200) }).nullable(),
});
export type SecurityGuardDashboardResponse = z.infer<typeof SecurityGuardDashboardResponseSchema>;
