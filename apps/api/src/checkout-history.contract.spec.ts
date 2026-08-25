import {
  AttendanceHistoryResponseSchema,
  AttendanceRecordSchema,
  ListAttendanceHistoryQuerySchema,
  TodayAttendanceResponseSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

const baseAttendance = {
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
};

describe('checkout and attendance history contracts', () => {
  it('defines completed attendance with server-calculated checkout values', () => {
    const completed = AttendanceRecordSchema.parse({
      ...baseAttendance,
      checkOutAt: '2026-08-25T08:35:59.000Z',
      checkOutLatitude: -6.2,
      checkOutLongitude: 106.816666,
      checkOutAccuracyMeters: 12,
      checkOutDistanceMeters: 0,
      workedMinutes: 510,
      workDeficitMinutes: 5,
      status: 'COMPLETED',
    });

    expect(completed).toMatchObject({
      status: 'COMPLETED',
      workedMinutes: 510,
      workDeficitMinutes: 5,
    });
  });

  it('represents forgotten checkout without inventing a checkout timestamp', () => {
    const incomplete = AttendanceRecordSchema.parse({
      ...baseAttendance,
      checkOutAt: null,
      workedMinutes: 455,
      workDeficitMinutes: 60,
      status: 'INCOMPLETE',
    });

    expect(incomplete.status).toBe('INCOMPLETE');
    if (incomplete.status !== 'INCOMPLETE') throw new Error('Status tidak lengkap');
    expect(incomplete.checkOutAt).toBeNull();
    expect(incomplete).not.toHaveProperty('checkOutLatitude');
  });

  it('validates month pagination and the paginated response shape', () => {
    expect(
      ListAttendanceHistoryQuerySchema.parse({
        page: '2',
        pageSize: '10',
        month: '2026-08',
      }),
    ).toEqual({ page: 2, pageSize: 10, month: '2026-08' });
    expect(
      ListAttendanceHistoryQuerySchema.safeParse({ month: '2026-13' }).success,
    ).toBe(false);

    expect(
      AttendanceHistoryResponseSchema.parse({
        data: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 0,
        },
      }).data,
    ).toEqual([]);
  });

  it('keeps today state and attendance variants consistent', () => {
    const invalid = TodayAttendanceResponseSchema.safeParse({
      serverNow: '2026-08-25T10:01:00.000Z',
      workDate: '2026-08-25',
      state: 'COMPLETED',
      schedule: null,
      attendance: {
        ...baseAttendance,
        status: 'CHECKED_IN',
      },
    });

    expect(invalid.success).toBe(false);
  });
});
