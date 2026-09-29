import { z } from 'zod';

import { TodayAttendanceResponseSchema } from './attendance.js';
import { EarlyDepartureStatusSchema } from './early-departure-requests.js';
import { LeaveStatusSchema, LeaveTypeSchema } from './leave-requests.js';
import { RequestAttachmentMetadataSchema } from './request-attachments.js';
import { CalendarMonthSchema, RequestQuotaResponseSchema } from './request-quotas.js';
import { SecurityGuardDashboardResponseSchema } from './security-dashboard.js';
import { LocalDateSchema, ScheduleTypeSchema } from './settings.js';
import { PaginationSchema } from './teachers.js';

export const DashboardActivityFilterSchema = z.enum([
  'ALL',
  'ATTENDANCE',
  'LEAVE',
  'EARLY_DEPARTURE',
]);
export type DashboardActivityFilter = z.infer<typeof DashboardActivityFilterSchema>;

export const StaffDashboardQuerySchema = z.strictObject({
  month: CalendarMonthSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  type: DashboardActivityFilterSchema.default('ALL'),
});
export type StaffDashboardQuery = z.infer<typeof StaffDashboardQuerySchema>;

const AttendanceActivitySchema = z.strictObject({
  type: z.literal('ATTENDANCE'),
  id: z.uuid(),
  workDate: LocalDateSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  checkInAt: z.iso.datetime({ offset: true }),
  checkOutAt: z.iso.datetime({ offset: true }).nullable(),
  status: z.enum(['CHECKED_IN', 'COMPLETED', 'INCOMPLETE']),
  scheduleType: ScheduleTypeSchema,
  arrivalOffsetMinutes: z.number().int(),
  actualLateMinutes: z.number().int().nonnegative(),
  effectiveLateMinutes: z.number().int().nonnegative(),
  lateArrivalStatus: LeaveStatusSchema.nullable(),
  workedMinutes: z.number().int().nonnegative().nullable(),
  workDeficitMinutes: z.number().int().nonnegative().nullable(),
});

const LeaveActivitySchema = z.strictObject({
  type: z.literal('LEAVE'),
  id: z.uuid(),
  workDate: LocalDateSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  leaveType: LeaveTypeSchema,
  status: LeaveStatusSchema,
  reason: z.string().trim().min(1).max(1000),
  decisionNote: z.string().nullable(),
  attachment: RequestAttachmentMetadataSchema.nullable(),
});

export const EarlyDepartureDashboardActivitySchema = z.strictObject({
  type: z.literal('EARLY_DEPARTURE'),
  id: z.uuid(),
  workDate: LocalDateSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  status: EarlyDepartureStatusSchema,
  reason: z.string().trim().min(1).max(1000),
  decisionNote: z.string().nullable(),
  attachment: RequestAttachmentMetadataSchema.nullable(),
});
export type EarlyDepartureDashboardActivity = z.infer<typeof EarlyDepartureDashboardActivitySchema>;

export const DashboardActivitySchema = z.discriminatedUnion('type', [
  AttendanceActivitySchema,
  LeaveActivitySchema,
  EarlyDepartureDashboardActivitySchema,
]);
export type DashboardActivity = z.infer<typeof DashboardActivitySchema>;

export const PunctualityTrendItemSchema = z.strictObject({
  workDate: LocalDateSchema,
  arrivalOffsetMinutes: z.number().int(),
  actualLateMinutes: z.number().int().nonnegative(),
  effectiveLateMinutes: z.number().int().nonnegative(),
  lateArrivalStatus: LeaveStatusSchema.nullable(),
});
export type PunctualityTrendItem = z.infer<typeof PunctualityTrendItemSchema>;

export const AttendanceTrendStatusSchema = z.enum([
  'COMPLETED',
  'CHECKED_IN',
  'INCOMPLETE',
  'LEAVE_PENDING',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'ABSENT',
  'OPEN',
  'NON_WORKING_DAY',
  'FUTURE',
  'CONFIGURATION_MISSING',
  'NOT_TRACKED',
]);
export type AttendanceTrendStatus = z.infer<typeof AttendanceTrendStatusSchema>;

const AttendanceTrendMetricsSchema = z.strictObject({
  arrivalOffsetMinutes: z.number().int(),
  lateMinutes: z.number().int().nonnegative(),
  workedMinutes: z.number().int().nonnegative().nullable(),
  workDeficitMinutes: z.number().int().nonnegative().nullable(),
});

export const AttendanceTrendDaySchema = z.strictObject({
  workDate: LocalDateSchema,
  status: AttendanceTrendStatusSchema,
  targetMinutes: z.number().int().nonnegative().nullable(),
  actual: z.strictObject({
    checkInAt: z.iso.datetime({ offset: true }),
    checkOutAt: z.iso.datetime({ offset: true }).nullable(),
  }).merge(AttendanceTrendMetricsSchema).nullable(),
  effective: AttendanceTrendMetricsSchema.nullable(),
  credit: z.strictObject({
    lateArrival: z.boolean(),
    earlyDeparture: z.boolean(),
  }),
});
export type AttendanceTrendDay = z.infer<typeof AttendanceTrendDaySchema>;

export const StaffDashboardMetricsSchema = z.strictObject({
  attendanceDays: z.number().int().nonnegative(),
  onTimeDays: z.number().int().nonnegative(),
  actualLateDays: z.number().int().nonnegative(),
  effectiveLateDays: z.number().int().nonnegative(),
  lateArrivalPermissionDays: z.number().int().nonnegative(),
  totalWorkedMinutes: z.number().int().nonnegative(),
  totalWorkDeficitMinutes: z.number().int().nonnegative(),
});

const AvailableStreakSchema = z.strictObject({
  status: z.literal('AVAILABLE'),
  currentDays: z.number().int().nonnegative(),
  tier: z.enum(['NONE', 'RED', 'BLUE', 'PURPLE']),
  nextMilestone: z.union([z.literal(3), z.literal(7), z.literal(14)]).nullable(),
  daysRemaining: z.number().int().nonnegative(),
  provisional: z.boolean(),
});

const UnavailableStreakSchema = z.strictObject({
  status: z.literal('UNAVAILABLE'),
  reason: z.literal('CONFIGURATION_MISSING'),
});

export const TeacherStreakSchema = z.discriminatedUnion('status', [
  AvailableStreakSchema,
  UnavailableStreakSchema,
]);
export type TeacherStreak = z.infer<typeof TeacherStreakSchema>;

export const StaffDashboardResponseSchema = z.strictObject({
  serverNow: z.iso.datetime({ offset: true }),
  role: z.enum(['USER', 'SECURITY_GUARD']),
  month: CalendarMonthSchema,
  todayAttendance: TodayAttendanceResponseSchema,
  securityDuty: SecurityGuardDashboardResponseSchema.nullable(),
  requestQuotas: RequestQuotaResponseSchema,
  metrics: StaffDashboardMetricsSchema,
  punctualityTrend: z.array(PunctualityTrendItemSchema),
  attendanceTrend: z.array(AttendanceTrendDaySchema),
  activity: z.strictObject({
    data: z.array(DashboardActivitySchema),
    pagination: PaginationSchema,
  }),
  latestEarlyDeparture: EarlyDepartureDashboardActivitySchema.nullable(),
  streak: TeacherStreakSchema.nullable(),
});
export type StaffDashboardResponse = z.infer<typeof StaffDashboardResponseSchema>;
