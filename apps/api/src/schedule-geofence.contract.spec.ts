import {
  GeofenceSettingsQuerySchema,
  SaveGeofenceSettingsRequestSchema,
  SaveScheduleSettingsRequestSchema,
  SaveSecurityScheduleSettingsRequestSchema,
  SaveReportingSettingsRequestSchema,
  ReportingSettingsResponseSchema,
  SecurityScheduleSettingsResponseSchema,
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
  it('uses an explicit operational start date for report relevance', () => {
    expect(SaveReportingSettingsRequestSchema.parse({
      operationalStartDate: '2026-10-01',
    })).toEqual({ operationalStartDate: '2026-10-01' });
    expect(ReportingSettingsResponseSchema.parse({
      operationalStartDate: '2026-10-01',
      locked: false,
    })).toEqual({ operationalStartDate: '2026-10-01', locked: false });
    expect(SaveReportingSettingsRequestSchema.safeParse({
      operationalStartDate: '2026-02-30',
    }).success).toBe(false);
  });

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

  it('accepts a Satpam night shift whose checkout segment is on the next day', () => {
    const input = {
      dayShift: {
        checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00',
        checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00', targetMinutes: 720,
      },
      nightShift: {
        checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
        checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
      },
      dayOneMorningGuardId: '11111111-1111-4111-8111-111111111111',
      dayOneNightGuardId: '22222222-2222-4222-8222-222222222222',
      dayOneOffGuardId: '33333333-3333-4333-8333-333333333333',
    };

    expect(SaveSecurityScheduleSettingsRequestSchema.parse(input)).toEqual(input);
    expect(SaveSecurityScheduleSettingsRequestSchema.safeParse({
      ...input,
      nightShift: { ...input.nightShift, workEnd: '04:00' },
    }).success).toBe(false);
  });

  it('requires unique roster members and exposes a three-day rotation preview', () => {
    const guardId = '11111111-1111-4111-8111-111111111111';
    expect(SaveSecurityScheduleSettingsRequestSchema.safeParse({
      dayShift: weekday,
      nightShift: {
        checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
        checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
      },
      dayOneMorningGuardId: guardId,
      dayOneNightGuardId: guardId,
      dayOneOffGuardId: '33333333-3333-4333-8333-333333333333',
    }).success).toBe(false);

    expect(SecurityScheduleSettingsResponseSchema.safeParse({
      effectiveOn: '2026-09-07', dayShift: null, nightShift: null, roster: null,
      preview: [
        { workDate: '2026-09-07', rotationDay: 1, morningGuardId: guardId, nightGuardId: '22222222-2222-4222-8222-222222222222', offGuardId: '33333333-3333-4333-8333-333333333333' },
        { workDate: '2026-09-08', rotationDay: 2, morningGuardId: '33333333-3333-4333-8333-333333333333', nightGuardId: guardId, offGuardId: '22222222-2222-4222-8222-222222222222' },
        { workDate: '2026-09-09', rotationDay: 3, morningGuardId: '22222222-2222-4222-8222-222222222222', nightGuardId: '33333333-3333-4333-8333-333333333333', offGuardId: guardId },
      ],
    }).success).toBe(true);
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
