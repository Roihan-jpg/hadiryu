import {
  GeofenceSettingsQuerySchema,
  SaveGeofenceSettingsRequestSchema,
  SaveScheduleSettingsRequestSchema,
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
  it('accepts schedule settings without a client-controlled effective date', () => {
    expect(
      SaveScheduleSettingsRequestSchema.parse({
        weekday,
        saturday: { ...weekday, workEnd: '12:00', targetMinutes: 215 },
      }),
    ).toEqual({
      weekday,
      saturday: { ...weekday, workEnd: '12:00', targetMinutes: 215 },
    });
    expect(
      SaveScheduleSettingsRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        weekday,
        saturday: weekday,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid time order, non-positive targets, and unsupported fields', () => {
    expect(
      SaveScheduleSettingsRequestSchema.safeParse({
        weekday: { ...weekday, workStart: '05:00' },
        saturday: weekday,
      }).success,
    ).toBe(false);
    expect(
      SaveScheduleSettingsRequestSchema.safeParse({
        weekday: { ...weekday, targetMinutes: 0 },
        saturday: weekday,
      }).success,
    ).toBe(false);
    expect(
      SaveScheduleSettingsRequestSchema.safeParse({
        weekday,
        saturday: weekday,
        teacherId: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
      }).success,
    ).toBe(false);
  });

  it('accepts a bounded polygon attendance zone without a client date', () => {
    const vertices = [
      { latitude: -8.1327, longitude: 113.2218 },
      { latitude: -8.1327, longitude: 113.2221 },
      { latitude: -8.1330, longitude: 113.2221 },
      { latitude: -8.1330, longitude: 113.2218 },
    ];
    expect(
      SaveGeofenceSettingsRequestSchema.parse({
        shape: 'POLYGON',
        vertices,
        maxAccuracyMeters: 15,
      }),
    ).toEqual({
      shape: 'POLYGON',
      vertices,
      maxAccuracyMeters: 15,
    });
    expect(
      SaveGeofenceSettingsRequestSchema.safeParse({
        shape: 'POLYGON',
        vertices: vertices.slice(0, 2),
        maxAccuracyMeters: 31,
      }).success,
    ).toBe(false);
    expect(
      SaveGeofenceSettingsRequestSchema.safeParse({
        effectiveFrom: '2026-09-01',
        shape: 'POLYGON',
        vertices,
        maxAccuracyMeters: 15,
      }).success,
    ).toBe(false);
  });

  it('rejects self-intersecting and repeated polygon vertices', () => {
    const base = { shape: 'POLYGON', maxAccuracyMeters: 15 } as const;
    expect(SaveGeofenceSettingsRequestSchema.safeParse({
      ...base,
      vertices: [
        { latitude: -8.1330, longitude: 113.2218 },
        { latitude: -8.1327, longitude: 113.2221 },
        { latitude: -8.1330, longitude: 113.2221 },
        { latitude: -8.1327, longitude: 113.2218 },
      ],
    }).success).toBe(false);
    expect(SaveGeofenceSettingsRequestSchema.safeParse({
      ...base,
      vertices: [
        { latitude: -8.1327, longitude: 113.2218 },
        { latitude: -8.1327, longitude: 113.2218 },
        { latitude: -8.1330, longitude: 113.2221 },
      ],
    }).success).toBe(false);
    expect(SaveGeofenceSettingsRequestSchema.safeParse({
      ...base,
      vertices: [
        { latitude: -8.1327, longitude: 113.2218 },
        { latitude: -8.1328, longitude: 113.2219 },
        { latitude: -8.1329, longitude: 113.2220 },
      ],
    }).success).toBe(false);
    expect(SaveGeofenceSettingsRequestSchema.safeParse({
      ...base,
      vertices: [
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 3 },
        { latitude: 3, longitude: 3 },
        { latitude: 3, longitude: 2 },
        { latitude: 0, longitude: 2 },
        { latitude: 0, longitude: 1 },
        { latitude: 3, longitude: 1 },
        { latitude: 3, longitude: 0 },
      ],
    }).success).toBe(false);
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
