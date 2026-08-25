import { z } from 'zod';

export const LocalDateSchema = z.iso.date();
export const ScheduleTypeSchema = z.enum(['WEEKDAY', 'SATURDAY']);
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;

const TimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Waktu wajib memakai format HH:mm');

const scheduleTimeFields = [
  'checkInOpen',
  'workStart',
  'checkInClose',
  'checkoutOpen',
  'workEnd',
  'checkoutClose',
] as const;

function minutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

export const ScheduleRuleInputSchema = z
  .strictObject({
    checkInOpen: TimeSchema,
    workStart: TimeSchema,
    checkInClose: TimeSchema,
    checkoutOpen: TimeSchema,
    workEnd: TimeSchema,
    checkoutClose: TimeSchema,
    targetMinutes: z.number().int().positive('Target menit wajib lebih dari nol'),
  })
  .superRefine((value, context) => {
    for (let index = 1; index < scheduleTimeFields.length; index += 1) {
      const previous = scheduleTimeFields[index - 1]!;
      const current = scheduleTimeFields[index]!;
      if (minutes(value[current]) < minutes(value[previous])) {
        context.addIssue({
          code: 'custom',
          message: 'Urutan waktu jadwal tidak valid',
          path: [current],
        });
      }
    }
  });
export type ScheduleRuleInput = z.infer<typeof ScheduleRuleInputSchema>;

export const ScheduleRuleSchema = z.strictObject({
  id: z.uuid(),
  scheduleType: ScheduleTypeSchema,
  checkInOpen: TimeSchema,
  workStart: TimeSchema,
  checkInClose: TimeSchema,
  checkoutOpen: TimeSchema,
  workEnd: TimeSchema,
  checkoutClose: TimeSchema,
  targetMinutes: z.number().int().positive(),
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable(),
});
export type ScheduleRule = z.infer<typeof ScheduleRuleSchema>;

export const CreateScheduleVersionRequestSchema = z.strictObject({
  effectiveFrom: LocalDateSchema,
  weekday: ScheduleRuleInputSchema,
  saturday: ScheduleRuleInputSchema,
});
export type CreateScheduleVersionRequest = z.infer<
  typeof CreateScheduleVersionRequestSchema
>;

export const ScheduleSettingsQuerySchema = z.strictObject({
  effectiveOn: LocalDateSchema,
});
export type ScheduleSettingsQuery = z.infer<typeof ScheduleSettingsQuerySchema>;

export const ScheduleSettingsResponseSchema = z.strictObject({
  effectiveOn: LocalDateSchema,
  weekday: ScheduleRuleSchema.nullable(),
  saturday: ScheduleRuleSchema.nullable(),
});
export type ScheduleSettingsResponse = z.infer<
  typeof ScheduleSettingsResponseSchema
>;

export const GeofenceRuleInputSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(1000),
  maxAccuracyMeters: z.number().int().min(5).max(200),
});
export type GeofenceRuleInput = z.infer<typeof GeofenceRuleInputSchema>;

export const GeofenceRuleSchema = z.strictObject({
  id: z.uuid(),
  ...GeofenceRuleInputSchema.shape,
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable(),
});
export type GeofenceRule = z.infer<typeof GeofenceRuleSchema>;

export const CreateGeofenceVersionRequestSchema = z.strictObject({
  effectiveFrom: LocalDateSchema,
  ...GeofenceRuleInputSchema.shape,
});
export type CreateGeofenceVersionRequest = z.infer<
  typeof CreateGeofenceVersionRequestSchema
>;

export const GeofenceSettingsQuerySchema = ScheduleSettingsQuerySchema;
export type GeofenceSettingsQuery = ScheduleSettingsQuery;

export const GeofenceSettingsResponseSchema = z.strictObject({
  effectiveOn: LocalDateSchema,
  geofence: GeofenceRuleSchema.nullable(),
});
export type GeofenceSettingsResponse = z.infer<
  typeof GeofenceSettingsResponseSchema
>;

export const CalendarExceptionTypeSchema = z.enum(['HOLIDAY', 'WORKING_DAY']);
export type CalendarExceptionType = z.infer<typeof CalendarExceptionTypeSchema>;

const CalendarExceptionNameSchema = z.string().trim().min(1).max(200);

export const CalendarExceptionInputSchema = z.discriminatedUnion('exceptionType', [
  z.strictObject({
    workDate: LocalDateSchema,
    exceptionType: z.literal('HOLIDAY'),
    name: CalendarExceptionNameSchema,
    scheduleType: z.null(),
  }),
  z.strictObject({
    workDate: LocalDateSchema,
    exceptionType: z.literal('WORKING_DAY'),
    name: CalendarExceptionNameSchema,
    scheduleType: ScheduleTypeSchema,
  }),
]);
export type CalendarExceptionInput = z.infer<typeof CalendarExceptionInputSchema>;

export const CalendarExceptionSchema = CalendarExceptionInputSchema.and(
  z.strictObject({ id: z.uuid() }),
);
export type CalendarException = z.infer<typeof CalendarExceptionSchema>;

export const CalendarExceptionsResponseSchema = z.strictObject({
  exceptions: z.array(CalendarExceptionSchema),
});
export type CalendarExceptionsResponse = z.infer<
  typeof CalendarExceptionsResponseSchema
>;

export const CalendarDayResolutionSchema = z.strictObject({
  workDate: LocalDateSchema,
  isWorkingDay: z.boolean(),
  scheduleType: ScheduleTypeSchema.nullable(),
  exception: CalendarExceptionSchema.nullable(),
});
export type CalendarDayResolution = z.infer<typeof CalendarDayResolutionSchema>;

const MoneySchema = z
  .number()
  .finite()
  .min(0)
  .max(999_999_999_999.99)
  .refine((value) => Math.round(value * 100) === value * 100, {
    message: 'Nilai uang maksimal memiliki dua angka desimal',
  });

export const PayrollRuleInputSchema = z.strictObject({
  basePerformancePay: MoneySchema,
  deductionRatePerMinute: MoneySchema,
});
export type PayrollRuleInput = z.infer<typeof PayrollRuleInputSchema>;

export const PayrollRuleSchema = z.strictObject({
  id: z.uuid(),
  ...PayrollRuleInputSchema.shape,
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable(),
});
export type PayrollRule = z.infer<typeof PayrollRuleSchema>;

export const CreatePayrollVersionRequestSchema = z
  .strictObject({
    effectiveFrom: LocalDateSchema,
    ...PayrollRuleInputSchema.shape,
  })
  .refine((value) => value.effectiveFrom.endsWith('-01'), {
    message: 'Tanggal mulai upah harus tanggal 1',
    path: ['effectiveFrom'],
  });
export type CreatePayrollVersionRequest = z.infer<
  typeof CreatePayrollVersionRequestSchema
>;

export const PayrollSettingsQuerySchema = ScheduleSettingsQuerySchema;
export type PayrollSettingsQuery = ScheduleSettingsQuery;

export const PayrollSettingsResponseSchema = z.strictObject({
  effectiveOn: LocalDateSchema,
  payrollRule: PayrollRuleSchema.nullable(),
});
export type PayrollSettingsResponse = z.infer<typeof PayrollSettingsResponseSchema>;

export const PerformancePayCalculationSchema = z.strictObject({
  totalWorkDeficitMinutes: z.number().int().nonnegative(),
  basePerformancePay: MoneySchema,
  deductionRatePerMinute: MoneySchema,
  deductionAmount: MoneySchema,
  finalPerformancePay: z.number().finite(),
});
export type PerformancePayCalculation = z.infer<
  typeof PerformancePayCalculationSchema
>;
