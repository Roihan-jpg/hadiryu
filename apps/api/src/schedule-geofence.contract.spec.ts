import {
  CreateGeofenceVersionRequestSchema,
  CreateScheduleVersionRequestSchema,
  GeofenceSettingsQuerySchema,
  ScheduleSettingsQuerySchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

const weekday = {
  checkInOpen: '05:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '12:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
};

describe('schedule-geofence contracts', () => {
  it('accepts one WEEKDAY and one SATURDAY rule for a new effective version', () => {
    expect(
      CreateScheduleVersionRequestSchema.parse({
        effectiveFrom: '2026-09-01',
        weekday,
        saturday: { ...weekday, workEnd: '12:00', targetMinutes: 215 },
      }),
    ).toEqual({
      effectiveFrom: '2026-09-01',
      weekday,
      saturday: { ...weekday, workEnd: '12:00', targetMinutes: 215 },
    });
  });

  it('rejects invalid time order, non-positive targets, and unsupported fields', () => {
    expect(
      CreateScheduleVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        weekday: { ...weekday, workStart: '05:00' },
        saturday: weekday,
      }).success,
    ).toBe(false);
    expect(
      CreateScheduleVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        weekday: { ...weekday, targetMinutes: 0 },
        saturday: weekday,
      }).success,
    ).toBe(false);
    expect(
      CreateScheduleVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        weekday,
        saturday: weekday,
        teacherId: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
      }).success,
    ).toBe(false);
  });

  it('accepts one bounded school geofence and rejects multiple locations', () => {
    expect(
      CreateGeofenceVersionRequestSchema.parse({
        effectiveFrom: '2026-09-01',
        latitude: -6.2,
        longitude: 106.816666,
        radiusMeters: 100,
        maxAccuracyMeters: 50,
      }),
    ).toEqual({
      effectiveFrom: '2026-09-01',
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 100,
      maxAccuracyMeters: 50,
    });
    expect(
      CreateGeofenceVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        latitude: 91,
        longitude: 106.816666,
        radiusMeters: 24,
        maxAccuracyMeters: 201,
      }).success,
    ).toBe(false);
    expect(
      CreateGeofenceVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        locations: [],
      }).success,
    ).toBe(false);
  });

  it('requires a real local date when resolving historical settings', () => {
    expect(ScheduleSettingsQuerySchema.parse({ effectiveOn: '2024-02-29' })).toEqual({
      effectiveOn: '2024-02-29',
    });
    expect(GeofenceSettingsQuerySchema.parse({ effectiveOn: '2026-08-25' })).toEqual({
      effectiveOn: '2026-08-25',
    });
    expect(
      ScheduleSettingsQuerySchema.safeParse({ effectiveOn: '2026-02-30' }).success,
    ).toBe(false);
  });
});
