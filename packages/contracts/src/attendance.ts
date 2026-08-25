import { z } from 'zod';

import { LocalDateSchema, ScheduleTypeSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';

const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const LocationInputSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
});
export type LocationInput = z.infer<typeof LocationInputSchema>;

const AttendanceBaseSchema = z.strictObject({
  id: z.uuid(),
  workDate: LocalDateSchema,
  checkInAt: z.iso.datetime({ offset: true }),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().nonnegative(),
  distanceMeters: z.number().finite().nonnegative(),
  workStart: TimeSchema,
  workEnd: TimeSchema,
  checkoutClose: TimeSchema,
  targetMinutes: z.number().int().positive(),
  arrivalLateMinutes: z.number().int().nonnegative(),
});

export const CheckInRecordSchema = AttendanceBaseSchema.extend({
  status: z.literal('CHECKED_IN'),
});
export type CheckInRecord = z.infer<typeof CheckInRecordSchema>;

export const CompletedAttendanceRecordSchema = AttendanceBaseSchema.extend({
  checkOutAt: z.iso.datetime({ offset: true }),
  checkOutLatitude: z.number().finite().min(-90).max(90),
  checkOutLongitude: z.number().finite().min(-180).max(180),
  checkOutAccuracyMeters: z.number().finite().nonnegative(),
  checkOutDistanceMeters: z.number().finite().nonnegative(),
  workedMinutes: z.number().int().nonnegative(),
  workDeficitMinutes: z.number().int().nonnegative(),
  status: z.literal('COMPLETED'),
});
export type CompletedAttendanceRecord = z.infer<
  typeof CompletedAttendanceRecordSchema
>;

export const IncompleteAttendanceRecordSchema = AttendanceBaseSchema.extend({
  checkOutAt: z.null(),
  workedMinutes: z.number().int().nonnegative(),
  workDeficitMinutes: z.number().int().nonnegative(),
  status: z.literal('INCOMPLETE'),
});
export type IncompleteAttendanceRecord = z.infer<
  typeof IncompleteAttendanceRecordSchema
>;

export const AttendanceRecordSchema = z.discriminatedUnion('status', [
  CheckInRecordSchema,
  CompletedAttendanceRecordSchema,
  IncompleteAttendanceRecordSchema,
]);
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const TodayScheduleSchema = z.strictObject({
  scheduleType: ScheduleTypeSchema,
  checkInOpen: TimeSchema,
  workStart: TimeSchema,
  checkInClose: TimeSchema,
  checkoutOpen: TimeSchema,
  workEnd: TimeSchema,
  checkoutClose: TimeSchema,
  targetMinutes: z.number().int().positive(),
});
export type TodaySchedule = z.infer<typeof TodayScheduleSchema>;

const TodayResponseBaseSchema = z.strictObject({
  serverNow: z.iso.datetime({ offset: true }),
  workDate: LocalDateSchema,
});

export const TodayAttendanceResponseSchema = z.discriminatedUnion('state', [
  TodayResponseBaseSchema.extend({
    state: z.literal('READY_TO_CHECK_IN'),
    schedule: TodayScheduleSchema,
    attendance: z.null(),
  }),
  TodayResponseBaseSchema.extend({
    state: z.literal('CHECKED_IN'),
    schedule: TodayScheduleSchema.nullable(),
    attendance: CheckInRecordSchema,
  }),
  TodayResponseBaseSchema.extend({
    state: z.literal('COMPLETED'),
    schedule: TodayScheduleSchema.nullable(),
    attendance: CompletedAttendanceRecordSchema,
  }),
  TodayResponseBaseSchema.extend({
    state: z.literal('INCOMPLETE'),
    schedule: TodayScheduleSchema.nullable(),
    attendance: IncompleteAttendanceRecordSchema,
  }),
  TodayResponseBaseSchema.extend({
    state: z.literal('NON_WORKING_DAY'),
    schedule: z.null(),
    attendance: z.null(),
  }),
  TodayResponseBaseSchema.extend({
    state: z.literal('CONFIGURATION_ERROR'),
    schedule: TodayScheduleSchema.nullable(),
    attendance: z.null(),
  }),
]);
export type TodayAttendanceResponse = z.infer<
  typeof TodayAttendanceResponseSchema
>;

export const ListAttendanceHistoryQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  month: z
    .string()
    .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Bulan wajib memakai format YYYY-MM')
    .optional(),
});
export type ListAttendanceHistoryQuery = z.infer<
  typeof ListAttendanceHistoryQuerySchema
>;

export const AttendanceHistoryResponseSchema = z.strictObject({
  data: z.array(AttendanceRecordSchema),
  pagination: PaginationSchema,
});
export type AttendanceHistoryResponse = z.infer<
  typeof AttendanceHistoryResponseSchema
>;
