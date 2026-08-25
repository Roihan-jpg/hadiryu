import type {
  AttendanceHistoryResponse,
  AttendanceRecord,
  CalendarException,
  CheckInRecord,
  CompletedAttendanceRecord,
  GeofenceRule,
  LocationInput,
  ScheduleRule,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  createAttendanceService,
  type AttendanceRepository,
  type SaveCheckoutInput,
} from './attendance.js';

const teacherId = '50000000-0000-4000-8000-000000000001';
const location: LocationInput = {
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
};
const schedule: ScheduleRule = {
  id: '10000000-0000-4000-8000-000000000001',
  scheduleType: 'WEEKDAY',
  checkInOpen: '05:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '12:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};
const geofence: GeofenceRule = {
  id: '20000000-0000-4000-8000-000000000001',
  latitude: location.latitude,
  longitude: location.longitude,
  radiusMeters: 100,
  maxAccuracyMeters: 50,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};
const checkedIn: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:20.000Z',
  ...location,
  distanceMeters: 0,
  workStart: schedule.workStart,
  workEnd: schedule.workEnd,
  checkoutClose: schedule.checkoutClose,
  targetMinutes: schedule.targetMinutes,
  arrivalLateMinutes: 5,
  status: 'CHECKED_IN',
};

class FakeAttendanceRepository implements AttendanceRepository {
  attendance: CheckInRecord | CompletedAttendanceRecord | null = checkedIn;
  historyRecords: Array<CheckInRecord | CompletedAttendanceRecord> = [];
  schedule: ScheduleRule | null = schedule;
  geofence: GeofenceRule | null = geofence;
  checkoutCount = 0;

  async findAttendance() {
    return this.attendance;
  }

  async findCalendarException(): Promise<CalendarException | null> {
    return null;
  }

  async findSchedule(): Promise<ScheduleRule | null> {
    return this.schedule;
  }

  async findGeofence(): Promise<GeofenceRule | null> {
    return this.geofence;
  }

  async hasApprovedLeave(): Promise<boolean> {
    return false;
  }

  async saveCheckIn(): Promise<CheckInRecord> {
    return checkedIn;
  }

  async saveCheckout(input: SaveCheckoutInput): Promise<CompletedAttendanceRecord> {
    this.checkoutCount += 1;
    const completed: CompletedAttendanceRecord = {
      ...checkedIn,
      checkOutAt: input.checkOutAt,
      checkOutLatitude: input.location.latitude,
      checkOutLongitude: input.location.longitude,
      checkOutAccuracyMeters: input.location.accuracyMeters,
      checkOutDistanceMeters: input.distanceMeters,
      workedMinutes: input.workedMinutes,
      workDeficitMinutes: input.workDeficitMinutes,
      status: 'COMPLETED',
    };
    this.attendance = completed;
    return completed;
  }

  async listAttendanceHistory(): Promise<{
    records: Array<CheckInRecord | CompletedAttendanceRecord>;
    totalItems: number;
  }> {
    return {
      records: this.historyRecords,
      totalItems: this.historyRecords.length,
    };
  }
}

function serviceAt(repository: FakeAttendanceRepository, iso: string) {
  return createAttendanceService(repository, () => new Date(iso));
}

describe('checkout domain service', () => {
  it('uses server time, floors full minutes, and calculates the deficit', async () => {
    const repository = new FakeAttendanceRepository();

    const result = await serviceAt(
      repository,
      '2026-08-25T08:35:59.000Z',
    ).checkout(teacherId, location);

    expect(result).toMatchObject({
      checkOutAt: '2026-08-25T08:35:59.000Z',
      workedMinutes: 510,
      workDeficitMinutes: 5,
      arrivalLateMinutes: 5,
      status: 'COMPLETED',
    });
  });

  it('returns a completed record before revalidating a repeated request', async () => {
    const repository = new FakeAttendanceRepository();
    const first = await serviceAt(
      repository,
      '2026-08-25T08:35:59.000Z',
    ).checkout(teacherId, location);
    const repeated = await serviceAt(
      repository,
      '2026-08-25T12:00:00.000Z',
    ).checkout(teacherId, {
      latitude: 0,
      longitude: 0,
      accuracyMeters: 999,
    });

    expect(repeated).toEqual(first);
    expect(repository.checkoutCount).toBe(1);
  });

  it.each([
    {
      arrange(repository: FakeAttendanceRepository) {
        repository.attendance = null;
      },
      now: '2026-08-25T08:35:00.000Z',
      input: location,
      code: 'CHECK_IN_REQUIRED',
    },
    {
      arrange() {},
      now: '2026-08-25T04:59:00.000Z',
      input: location,
      code: 'OUTSIDE_ATTENDANCE_WINDOW',
    },
    {
      arrange() {},
      now: '2026-08-25T08:35:00.000Z',
      input: { ...location, accuracyMeters: 50.01 },
      code: 'LOCATION_INACCURATE',
    },
    {
      arrange() {},
      now: '2026-08-25T08:35:00.000Z',
      input: { ...location, latitude: -6.19 },
      code: 'OUTSIDE_GEOFENCE',
    },
  ])('rejects $code without mutating attendance', async ({ arrange, now, input, code }) => {
    const repository = new FakeAttendanceRepository();
    arrange(repository);

    await expect(
      serviceAt(repository, now).checkout(teacherId, input),
    ).rejects.toMatchObject({ code } satisfies Partial<AppError>);
    expect(repository.checkoutCount).toBe(0);
  });
});

describe('today and history derivation', () => {
  it('derives forgotten checkout after cutoff without persisting a timestamp', async () => {
    const repository = new FakeAttendanceRepository();

    const result = await serviceAt(
      repository,
      '2026-08-25T10:01:00.000Z',
    ).getToday(teacherId);

    expect(result).toMatchObject({
      state: 'INCOMPLETE',
      attendance: {
        checkOutAt: null,
        workedMinutes: 455,
        workDeficitMinutes: 60,
        status: 'INCOMPLETE',
      },
    });
    expect(repository.attendance).toEqual(checkedIn);
  });

  it('keeps a check-in open through the inclusive checkout-close minute', async () => {
    const repository = new FakeAttendanceRepository();

    const result = await serviceAt(
      repository,
      '2026-08-25T10:00:59.000Z',
    ).getToday(teacherId);

    expect(result.state).toBe('CHECKED_IN');
  });

  it('derives past incomplete records and preserves paginated metadata', async () => {
    const repository = new FakeAttendanceRepository();
    repository.historyRecords = [checkedIn];

    const result: AttendanceHistoryResponse = await serviceAt(
      repository,
      '2026-08-26T01:00:00.000Z',
    ).history(teacherId, { page: 2, pageSize: 10, month: '2026-08' });

    expect(result.data[0]).toMatchObject({
      workDate: '2026-08-25',
      checkOutAt: null,
      workedMinutes: 455,
      workDeficitMinutes: 60,
      status: 'INCOMPLETE',
    } satisfies Partial<AttendanceRecord>);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
  });
});
