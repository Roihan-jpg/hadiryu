import { z } from 'zod';

export const LocalDateSchema = z.iso.date();
export const ScheduleTypeSchema = z.enum([
  'WEEKDAY',
  'SATURDAY',
  'SECURITY_DAY',
  'SECURITY_NIGHT',
]);
export type ScheduleType = z.infer<typeof ScheduleTypeSchema>;
export const SchoolScheduleTypeSchema = z.enum(['WEEKDAY', 'SATURDAY']);

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

const ScheduleRuleFieldsSchema = z.strictObject({
    checkInOpen: TimeSchema,
    workStart: TimeSchema,
    checkInClose: TimeSchema,
    checkoutOpen: TimeSchema,
    workEnd: TimeSchema,
    checkoutClose: TimeSchema,
    targetMinutes: z.number().int().positive('Target menit wajib lebih dari nol'),
  });

function validateOrderedFields(
  value: z.infer<typeof ScheduleRuleFieldsSchema>,
  context: z.RefinementCtx,
  fields: readonly (typeof scheduleTimeFields)[number][],
): void {
  for (let index = 1; index < fields.length; index += 1) {
    const previous = fields[index - 1]!;
    const current = fields[index]!;
    if (minutes(value[current]) < minutes(value[previous])) {
      context.addIssue({
        code: 'custom',
        message: 'Urutan waktu jadwal tidak valid',
        path: [current],
      });
    }
  }
}

export const ScheduleRuleInputSchema = ScheduleRuleFieldsSchema
  .superRefine((value, context) => {
    validateOrderedFields(value, context, scheduleTimeFields);
  });
export type ScheduleRuleInput = z.infer<typeof ScheduleRuleInputSchema>;

export const OvernightScheduleRuleInputSchema = ScheduleRuleFieldsSchema
  .superRefine((value, context) => {
    validateOrderedFields(value, context, ['checkInOpen', 'workStart', 'checkInClose']);
    validateOrderedFields(value, context, ['checkoutOpen', 'workEnd', 'checkoutClose']);
  });
export type OvernightScheduleRuleInput = z.infer<typeof OvernightScheduleRuleInputSchema>;

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

export const SaveScheduleSettingsRequestSchema = z.strictObject({
  weekday: ScheduleRuleInputSchema,
  saturday: ScheduleRuleInputSchema,
});
export type SaveScheduleSettingsRequest = z.infer<
  typeof SaveScheduleSettingsRequestSchema
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

export const SecurityRosterSchema = z
  .strictObject({
    dayOneMorningGuardId: z.uuid(),
    dayOneNightGuardId: z.uuid(),
    dayOneOffGuardId: z.uuid(),
    effectiveFrom: LocalDateSchema,
    effectiveTo: LocalDateSchema.nullable(),
  })
  .refine((value) => new Set([
    value.dayOneMorningGuardId,
    value.dayOneNightGuardId,
    value.dayOneOffGuardId,
  ]).size === 3, 'Tiga Satpam dalam roster harus berbeda');
export type SecurityRoster = z.infer<typeof SecurityRosterSchema>;

export const SaveSecurityScheduleSettingsRequestSchema = z.strictObject({
  dayShift: ScheduleRuleInputSchema,
  nightShift: OvernightScheduleRuleInputSchema,
  dayOneMorningGuardId: z.uuid(),
  dayOneNightGuardId: z.uuid(),
  dayOneOffGuardId: z.uuid(),
}).refine((value) => new Set([
  value.dayOneMorningGuardId,
  value.dayOneNightGuardId,
  value.dayOneOffGuardId,
]).size === 3, 'Tiga Satpam dalam roster harus berbeda');
export type SaveSecurityScheduleSettingsRequest = z.infer<
  typeof SaveSecurityScheduleSettingsRequestSchema
>;

export const SecurityRotationPreviewItemSchema = z.strictObject({
  workDate: LocalDateSchema,
  rotationDay: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  morningGuardId: z.uuid(),
  nightGuardId: z.uuid(),
  offGuardId: z.uuid(),
});
export type SecurityRotationPreviewItem = z.infer<typeof SecurityRotationPreviewItemSchema>;

export const SecurityScheduleSettingsResponseSchema = z.strictObject({
  effectiveOn: LocalDateSchema,
  dayShift: ScheduleRuleSchema.nullable(),
  nightShift: ScheduleRuleSchema.nullable(),
  roster: SecurityRosterSchema.nullable(),
  preview: z.array(SecurityRotationPreviewItemSchema).max(3),
});
export type SecurityScheduleSettingsResponse = z.infer<
  typeof SecurityScheduleSettingsResponseSchema
>;

export const GeofenceCoordinateSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type GeofenceCoordinate = z.infer<typeof GeofenceCoordinateSchema>;

export const CircleGeofenceRuleInputSchema = z.strictObject({
  shape: z.literal('CIRCLE'),
  ...GeofenceCoordinateSchema.shape,
  radiusMeters: z.number().int().min(25).max(1000),
  maxAccuracyMeters: z.number().int().min(5).max(200),
});

function orientation(
  a: GeofenceCoordinate,
  b: GeofenceCoordinate,
  c: GeofenceCoordinate,
): number {
  return (b.longitude - a.longitude) * (c.latitude - a.latitude) -
    (b.latitude - a.latitude) * (c.longitude - a.longitude);
}

function segmentsIntersect(
  a: GeofenceCoordinate,
  b: GeofenceCoordinate,
  c: GeofenceCoordinate,
  d: GeofenceCoordinate,
): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const epsilon = 1e-12;
  const onSegment = (
    start: GeofenceCoordinate,
    end: GeofenceCoordinate,
    point: GeofenceCoordinate,
  ) => point.longitude >= Math.min(start.longitude, end.longitude) - epsilon &&
    point.longitude <= Math.max(start.longitude, end.longitude) + epsilon &&
    point.latitude >= Math.min(start.latitude, end.latitude) - epsilon &&
    point.latitude <= Math.max(start.latitude, end.latitude) + epsilon;
  if (first * second < 0 && third * fourth < 0) return true;
  return (Math.abs(first) <= epsilon && onSegment(a, b, c)) ||
    (Math.abs(second) <= epsilon && onSegment(a, b, d)) ||
    (Math.abs(third) <= epsilon && onSegment(c, d, a)) ||
    (Math.abs(fourth) <= epsilon && onSegment(c, d, b));
}

function polygonIsSimple(vertices: readonly GeofenceCoordinate[]): boolean {
  const seen = new Set(vertices.map((vertex) => `${vertex.latitude},${vertex.longitude}`));
  if (seen.size !== vertices.length) return false;
  const origin = vertices[0]!;
  const twiceArea = vertices.reduce((area, vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return area +
      (vertex.longitude - origin.longitude) * (next.latitude - origin.latitude) -
      (next.longitude - origin.longitude) * (vertex.latitude - origin.latitude);
  }, 0);
  if (Math.abs(twiceArea) < 1e-12) return false;
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (
        first === second || firstNext === second || secondNext === first ||
        (first === 0 && secondNext === 0)
      ) continue;
      if (segmentsIntersect(
        vertices[first]!, vertices[firstNext]!,
        vertices[second]!, vertices[secondNext]!,
      )) return false;
    }
  }
  return true;
}

export const PolygonGeofenceRuleInputSchema = z.strictObject({
  shape: z.literal('POLYGON'),
  vertices: z.array(GeofenceCoordinateSchema).min(3).max(32),
  maxAccuracyMeters: z.number().int().min(5).max(30),
}).superRefine((value, context) => {
  if (!polygonIsSimple(value.vertices)) {
    context.addIssue({
      code: 'custom',
      message: 'Titik zona tidak boleh berulang atau membentuk garis yang berpotongan',
      path: ['vertices'],
    });
  }
});

export const GeofenceRuleInputSchema = z.union([
  CircleGeofenceRuleInputSchema,
  PolygonGeofenceRuleInputSchema,
]);
export type GeofenceRuleInput = z.infer<typeof GeofenceRuleInputSchema>;

const GeofenceVersionSchema = z.strictObject({
  id: z.uuid(),
  effectiveFrom: LocalDateSchema,
  effectiveTo: LocalDateSchema.nullable(),
});

export const GeofenceRuleSchema = z.union([
  CircleGeofenceRuleInputSchema.extend(GeofenceVersionSchema.shape),
  PolygonGeofenceRuleInputSchema.safeExtend(GeofenceVersionSchema.shape),
]);
export type GeofenceRule = z.infer<typeof GeofenceRuleSchema>;

export const SaveGeofenceSettingsRequestSchema = PolygonGeofenceRuleInputSchema;
export type SaveGeofenceSettingsRequest = z.infer<
  typeof SaveGeofenceSettingsRequestSchema
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
    scheduleType: SchoolScheduleTypeSchema,
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
