import type { GeofenceRule, ScheduleRule } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import {
  resolveGeofenceSettings,
  resolveScheduleSettings,
} from './schedule-geofence.js';

const weekdayHistorical: ScheduleRule = {
  id: '10000000-0000-4000-8000-000000000011',
  scheduleType: 'WEEKDAY',
  checkInOpen: '05:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '12:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-08-31',
};

const saturdayHistorical: ScheduleRule = {
  ...weekdayHistorical,
  id: '10000000-0000-4000-8000-000000000012',
  scheduleType: 'SATURDAY',
  workEnd: '10:35',
  targetMinutes: 215,
};

const weekdayEffective: ScheduleRule = {
  ...weekdayHistorical,
  id: '10000000-0000-4000-8000-000000000013',
  targetMinutes: 500,
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
};

const saturdayEffective: ScheduleRule = {
  ...saturdayHistorical,
  id: '10000000-0000-4000-8000-000000000014',
  targetMinutes: 200,
  effectiveFrom: '2026-09-01',
  effectiveTo: null,
};

describe('schedule-geofence effective resolver', () => {
  it('selects historical schedule rows through their inclusive end date', () => {
    const result = resolveScheduleSettings(
      [weekdayEffective, saturdayHistorical, weekdayHistorical, saturdayEffective],
      '2026-08-31',
    );

    expect(result.weekday?.id).toBe(weekdayHistorical.id);
    expect(result.saturday?.id).toBe(saturdayHistorical.id);
  });

  it('selects the new WEEKDAY and SATURDAY rows on their effective date', () => {
    const result = resolveScheduleSettings(
      [weekdayHistorical, weekdayEffective, saturdayHistorical, saturdayEffective],
      '2026-09-01',
    );

    expect(result).toMatchObject({
      effectiveOn: '2026-09-01',
      weekday: { id: weekdayEffective.id, targetMinutes: 500 },
      saturday: { id: saturdayEffective.id, targetMinutes: 200 },
    });
  });

  it('returns no schedule before the first configured version', () => {
    expect(
      resolveScheduleSettings(
        [weekdayHistorical, saturdayHistorical],
        '2025-12-31',
      ),
    ).toEqual({ effectiveOn: '2025-12-31', weekday: null, saturday: null });
  });

  it('resolves the single geofence historically and on its new effective date', () => {
    const historical: GeofenceRule = {
      id: '20000000-0000-4000-8000-000000000011',
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 100,
      maxAccuracyMeters: 50,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-08-31',
    };
    const effective: GeofenceRule = {
      ...historical,
      id: '20000000-0000-4000-8000-000000000012',
      radiusMeters: 125,
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
    };

    expect(
      resolveGeofenceSettings([effective, historical], '2026-08-31').geofence
        ?.id,
    ).toBe(historical.id);
    expect(
      resolveGeofenceSettings([historical, effective], '2026-09-01').geofence,
    ).toMatchObject({ id: effective.id, radiusMeters: 125 });
  });
});
