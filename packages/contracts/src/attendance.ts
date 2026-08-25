import { z } from 'zod';

import { LocalDateSchema, ScheduleTypeSchema } from './settings.js';

export const LocationInputSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
});
export type LocationInput = z.infer<typeof LocationInputSchema>;

export const CheckInRecordSchema = z.strictObject({
  id: z.uuid(),
  workDate: LocalDateSchema,
  checkInAt: z.iso.datetime({ offset: true }),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
  distanceMeters: z.number().finite().nonnegative(),
  workStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  workEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  checkoutClose: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  targetMinutes: z.number().int().positive(),
  arrivalLateMinutes: z.number().int().nonnegative(),
  status: z.literal('CHECKED_IN'),
});
export type CheckInRecord = z.infer<typeof CheckInRecordSchema>;

export const TodayScheduleSchema = z.strictObject({
  scheduleType: ScheduleTypeSchema,
  checkInOpen: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  workStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  checkInClose: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  workEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  targetMinutes: z.number().int().positive(),
});
export type TodaySchedule = z.infer<typeof TodayScheduleSchema>;

export const TodayAttendanceResponseSchema = z.strictObject({
  serverNow: z.iso.datetime({ offset: true }),
  workDate: LocalDateSchema,
  state: z.enum([
    'READY_TO_CHECK_IN',
    'CHECKED_IN',
    'NON_WORKING_DAY',
    'CONFIGURATION_ERROR',
  ]),
  schedule: TodayScheduleSchema.nullable(),
  attendance: CheckInRecordSchema.nullable(),
});
export type TodayAttendanceResponse = z.infer<
  typeof TodayAttendanceResponseSchema
>;

