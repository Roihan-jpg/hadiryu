import { z } from 'zod';

import { LeaveTypeSchema } from './leave-requests.js';
import { LocalDateSchema, ScheduleTypeSchema } from './settings.js';
import { StaffRoleSchema } from './teachers.js';

const TimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const MonthlyReportParamsSchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(9999),
  month: z.coerce.number().int().min(1).max(12),
});
export type MonthlyReportParams = z.infer<typeof MonthlyReportParamsSchema>;

export const DefaultReportPeriodSchema = z.strictObject({
  year: z.number().int().min(2000).max(9999),
  month: z.number().int().min(1).max(12),
});
export type DefaultReportPeriod = z.infer<typeof DefaultReportPeriodSchema>;

export const MonthlyReportReadinessIssueSchema = z.strictObject({
  code: z.enum([
    'SCHOOL_SCHEDULE_COVERAGE_MISSING',
    'SECURITY_SCHEDULE_COVERAGE_MISSING',
  ]),
  source: z.enum(['SCHOOL_SCHEDULE', 'SECURITY_SCHEDULE']),
  missingRanges: z
    .array(
      z.strictObject({
        startDate: LocalDateSchema,
        endDate: LocalDateSchema,
      }),
    )
    .min(1),
});
export type MonthlyReportReadinessIssue = z.infer<
  typeof MonthlyReportReadinessIssueSchema
>;

const MonthlyReportReadinessFields = {
  year: z.number().int().min(2000).max(9999),
  month: z.number().int().min(1).max(12),
  startDate: LocalDateSchema,
  endDate: LocalDateSchema,
};

export const MonthlyReportReadinessSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('READY'),
    ...MonthlyReportReadinessFields,
    issues: z.tuple([]),
  }),
  z.strictObject({
    status: z.literal('BLOCKED'),
    ...MonthlyReportReadinessFields,
    issues: z.array(MonthlyReportReadinessIssueSchema).min(1),
  }),
]);
export type MonthlyReportReadiness = z.infer<
  typeof MonthlyReportReadinessSchema
>;

export const MonthlyReportDayStatusSchema = z.enum([
  'WORKED',
  'INCOMPLETE',
  'LEAVE',
  'ABSENT',
  'NON_WORKING_DAY',
]);
export type MonthlyReportDayStatus = z.infer<
  typeof MonthlyReportDayStatusSchema
>;

const CommonDayFields = {
  workDate: LocalDateSchema,
  calendarExceptionName: z.string().trim().min(1).max(200).nullable(),
};

const NonWorkingDaySchema = z.strictObject({
  ...CommonDayFields,
  scheduleType: z.null(),
  status: z.literal('NON_WORKING_DAY'),
  attendanceId: z.null(),
  checkInAt: z.null(),
  checkOutAt: z.null(),
  workStart: z.null(),
  workEnd: z.null(),
  targetMinutes: z.literal(0),
  workedMinutes: z.literal(0),
  arrivalLateMinutes: z.literal(0),
  workDeficitMinutes: z.literal(0),
  leaveType: z.null(),
});

const WorkingDayBase = {
  ...CommonDayFields,
  scheduleType: ScheduleTypeSchema,
  workStart: TimeSchema,
  workEnd: TimeSchema,
  targetMinutes: z.number().int().positive(),
};

const WorkedDaySchema = z.strictObject({
  ...WorkingDayBase,
  status: z.literal('WORKED'),
  attendanceId: z.uuid(),
  checkInAt: z.iso.datetime({ offset: true }),
  checkOutAt: z.iso.datetime({ offset: true }),
  workedMinutes: z.number().int().nonnegative(),
  arrivalLateMinutes: z.number().int().nonnegative(),
  workDeficitMinutes: z.number().int().nonnegative(),
  leaveType: z.null(),
});

const IncompleteDaySchema = z.strictObject({
  ...WorkingDayBase,
  status: z.literal('INCOMPLETE'),
  attendanceId: z.uuid(),
  checkInAt: z.iso.datetime({ offset: true }),
  checkOutAt: z.null(),
  workedMinutes: z.number().int().nonnegative(),
  arrivalLateMinutes: z.number().int().nonnegative(),
  workDeficitMinutes: z.number().int().nonnegative(),
  leaveType: z.null(),
});

const LeaveDaySchema = z
  .strictObject({
    ...WorkingDayBase,
    status: z.literal('LEAVE'),
    attendanceId: z.null(),
    checkInAt: z.null(),
    checkOutAt: z.null(),
    workedMinutes: z.number().int().positive(),
    arrivalLateMinutes: z.literal(0),
    workDeficitMinutes: z.literal(0),
    leaveType: LeaveTypeSchema,
  })
  .refine((day) => day.workedMinutes === day.targetMinutes, {
    message: 'Kredit izin wajib sama dengan target menit',
    path: ['workedMinutes'],
  });

const AbsentDaySchema = z
  .strictObject({
    ...WorkingDayBase,
    status: z.literal('ABSENT'),
    attendanceId: z.null(),
    checkInAt: z.null(),
    checkOutAt: z.null(),
    workedMinutes: z.literal(0),
    arrivalLateMinutes: z.literal(0),
    workDeficitMinutes: z.number().int().positive(),
    leaveType: z.null(),
  })
  .refine((day) => day.workDeficitMinutes === day.targetMinutes, {
    message: 'Kekurangan absen wajib sama dengan target menit',
    path: ['workDeficitMinutes'],
  });

export const MonthlyReportDaySchema = z.discriminatedUnion('status', [
  WorkedDaySchema,
  IncompleteDaySchema,
  LeaveDaySchema,
  AbsentDaySchema,
  NonWorkingDaySchema,
]);
export type MonthlyReportDay = z.infer<typeof MonthlyReportDaySchema>;

export const MonthlyReportTeacherSchema = z
  .strictObject({
    teacherId: z.uuid(),
    teacherNip: z.string().trim().min(1),
    teacherFullName: z.string().trim().min(1).max(200),
    role: StaffRoleSchema.optional(),
    days: z.array(MonthlyReportDaySchema),
    totalWorkDeficitMinutes: z.number().int().nonnegative(),
    lateDayCount: z.number().int().nonnegative(),
    absentDayCount: z.number().int().nonnegative(),
    rejectedEarlyDepartureMinutes: z.number().int().nonnegative(),
  })
  .superRefine((teacher, context) => {
    const total = teacher.days.reduce(
      (sum, day) => sum + day.workDeficitMinutes,
      0,
    );
    if (teacher.totalWorkDeficitMinutes !== total) {
      context.addIssue({
        code: 'custom',
        message: 'Total kekurangan wajib sama dengan jumlah nilai harian',
        path: ['totalWorkDeficitMinutes'],
      });
    }
  });
export type MonthlyReportTeacher = z.infer<typeof MonthlyReportTeacherSchema>;

function calendarDates(year: number, month: number): string[] {
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: dayCount },
    (_, index) =>
      `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
  );
}

export const MonthlyReportPreviewSchema = z
  .strictObject({
    year: z.number().int().min(2000).max(9999),
    month: z.number().int().min(1).max(12),
    startDate: LocalDateSchema,
    endDate: LocalDateSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    teachers: z.array(MonthlyReportTeacherSchema),
  })
  .superRefine((report, context) => {
    const dates = calendarDates(report.year, report.month);
    if (report.startDate !== dates[0]) {
      context.addIssue({
        code: 'custom',
        message: 'Tanggal awal tidak sesuai periode laporan',
        path: ['startDate'],
      });
    }
    if (report.endDate !== dates.at(-1)) {
      context.addIssue({
        code: 'custom',
        message: 'Tanggal akhir tidak sesuai periode laporan',
        path: ['endDate'],
      });
    }
    for (let index = 0; index < report.teachers.length; index += 1) {
      const teacherDates = report.teachers[index]!.days.map((day) => day.workDate);
      if (
        teacherDates.length !== dates.length ||
        teacherDates.some((date, dayIndex) => date !== dates[dayIndex])
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Setiap Guru wajib memiliki satu hasil untuk setiap tanggal kalender',
          path: ['teachers', index, 'days'],
        });
      }
    }
  });
export type MonthlyReportPreview = z.infer<typeof MonthlyReportPreviewSchema>;
