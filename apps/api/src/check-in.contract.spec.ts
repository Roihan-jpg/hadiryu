import {
  CheckInRecordSchema,
  LocationInputSchema,
  TodayAttendanceResponseSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('check-in contracts', () => {
  it('accepts only finite coordinates and non-negative accuracy', () => {
    expect(
      LocationInputSchema.parse({
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: 12.5,
      }),
    ).toEqual({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 12.5,
    });
    expect(
      LocationInputSchema.safeParse({
        latitude: -91,
        longitude: 106.816666,
        accuracyMeters: 12.5,
      }).success,
    ).toBe(false);
    expect(
      LocationInputSchema.safeParse({
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects checkout fields and browser-provided timestamps', () => {
    expect(
      LocationInputSchema.safeParse({
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: 12.5,
        checkInAt: '2026-08-25T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('defines one CHECKED_IN response and explicit dashboard states', () => {
    const attendance = CheckInRecordSchema.parse({
      id: '40000000-0000-4000-8000-000000000001',
      workDate: '2026-08-25',
      checkInAt: '2026-08-25T00:05:00.000Z',
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
      distanceMeters: 0,
      workStart: '07:00',
      workEnd: '15:35',
      checkoutClose: '17:00',
      targetMinutes: 515,
      arrivalLateMinutes: 5,
      status: 'CHECKED_IN',
    });

    expect(
      TodayAttendanceResponseSchema.parse({
        serverNow: '2026-08-25T00:05:00.000Z',
        workDate: '2026-08-25',
        state: 'CHECKED_IN',
        schedule: {
          scheduleType: 'WEEKDAY',
          checkInOpen: '05:30',
          workStart: '07:00',
          checkInClose: '08:00',
          workEnd: '15:35',
          targetMinutes: 515,
        },
        attendance,
      }).state,
    ).toBe('CHECKED_IN');
  });
});
