import type {
  CalendarException,
  CheckInRecord,
  GeofenceRule,
  ScheduleRule,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  createAttendanceService,
  haversineDistanceMeters,
  type AttendanceRepository,
  type SaveCheckInInput,
} from './attendance.js';

const teacherId = '50000000-0000-4000-8000-000000000001';

const weekdaySchedule: ScheduleRule = {
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

const saturdaySchedule: ScheduleRule = {
  ...weekdaySchedule,
  id: '10000000-0000-4000-8000-000000000002',
  scheduleType: 'SATURDAY',
  workEnd: '10:35',
  checkoutClose: '12:00',
  targetMinutes: 215,
};

const geofence: GeofenceRule = {
  shape: 'CIRCLE',
  id: '20000000-0000-4000-8000-000000000001',
  latitude: -6.2,
  longitude: 106.816666,
  radiusMeters: 100,
  maxAccuracyMeters: 50,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};

const polygonGeofence: GeofenceRule = {
  id: '20000000-0000-4000-8000-000000000002',
  shape: 'POLYGON',
  vertices: [
    { latitude: -8.1331, longitude: 113.2217 },
    { latitude: -8.1331, longitude: 113.2223 },
    { latitude: -8.1325, longitude: 113.2223 },
    { latitude: -8.1325, longitude: 113.2217 },
  ],
  maxAccuracyMeters: 15,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};

class FakeAttendanceRepository implements AttendanceRepository {
  attendance: CheckInRecord | null = null;
  calendarException: CalendarException | null = null;
  schedule: ScheduleRule | null = weekdaySchedule;
  geofence: GeofenceRule | null = geofence;
  approvedLeave = false;
  saveCount = 0;

  async findAttendance(): Promise<CheckInRecord | null> {
    return this.attendance;
  }

  async findCalendarException(): Promise<CalendarException | null> {
    return this.calendarException;
  }

  async findSchedule(scheduleType: 'WEEKDAY' | 'SATURDAY'): Promise<ScheduleRule | null> {
    return this.schedule?.scheduleType === scheduleType ? this.schedule : null;
  }

  async findGeofence(): Promise<GeofenceRule | null> {
    return this.geofence;
  }

  async hasApprovedLeave(): Promise<boolean> {
    return this.approvedLeave;
  }

  async saveCheckIn(input: SaveCheckInInput): Promise<CheckInRecord> {
    this.saveCount += 1;
    this.attendance ??= {
      id: '40000000-0000-4000-8000-000000000001',
      workDate: input.workDate,
      checkInAt: input.checkInAt,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyMeters: input.location.accuracyMeters,
      distanceMeters: input.distanceMeters,
      boundaryClearanceMeters: input.boundaryClearanceMeters,
      workStart: input.schedule.workStart,
      workEnd: input.schedule.workEnd,
      checkoutClose: input.schedule.checkoutClose,
      targetMinutes: input.schedule.targetMinutes,
      arrivalLateMinutes: input.arrivalLateMinutes,
      scheduleType: input.schedule.scheduleType,
      checkInOpenAt: input.boundaries.checkInOpenAt,
      workStartAt: input.boundaries.workStartAt,
      checkInCloseAt: input.boundaries.checkInCloseAt,
      checkoutOpenAt: input.boundaries.checkoutOpenAt,
      workEndAt: input.boundaries.workEndAt,
      checkoutCloseAt: input.boundaries.checkoutCloseAt,
      status: 'CHECKED_IN',
    };
    return this.attendance;
  }

  async saveCheckout(): Promise<never> {
    throw new Error('not used');
  }

  async listAttendanceHistory() {
    return { records: [], totalItems: 0 };
  }
}

function serviceAt(repository: FakeAttendanceRepository, iso: string) {
  return createAttendanceService(repository, () => new Date(iso));
}

describe('Haversine', () => {
  it('returns zero for the same point and a stable real-world distance', () => {
    expect(haversineDistanceMeters(-6.2, 106.816666, -6.2, 106.816666)).toBe(0);
    expect(haversineDistanceMeters(0, 0, 0, 1)).toBeCloseTo(111_195.08, 0);
  });
});

describe('polygon geofence', () => {
  it('accepts a precise point whose uncertainty circle remains inside', async () => {
    const repository = new FakeAttendanceRepository();
    repository.geofence = polygonGeofence;

    const result = await serviceAt(repository, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -8.1328, longitude: 113.2220, accuracyMeters: 10 },
    );

    expect(result.boundaryClearanceMeters).toBeGreaterThan(20);
  });

  it('rejects points outside and uncertainty circles crossing the boundary', async () => {
    const outside = new FakeAttendanceRepository();
    outside.geofence = polygonGeofence;
    await expect(serviceAt(outside, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -8.1328, longitude: 113.2225, accuracyMeters: 5 },
    )).rejects.toMatchObject({ code: 'OUTSIDE_GEOFENCE' });

    const uncertain = new FakeAttendanceRepository();
    uncertain.geofence = polygonGeofence;
    await expect(serviceAt(uncertain, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -8.1328, longitude: 113.22225, accuracyMeters: 10 },
    )).rejects.toMatchObject({ code: 'LOCATION_UNCERTAIN_NEAR_BOUNDARY' });
  });

  it('rejects an exact-boundary reading even when the device reports zero uncertainty', async () => {
    const repository = new FakeAttendanceRepository();
    repository.geofence = polygonGeofence;

    await expect(serviceAt(repository, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -8.1328, longitude: 113.2222999999, accuracyMeters: 0 },
    )).rejects.toMatchObject({ code: 'LOCATION_UNCERTAIN_NEAR_BOUNDARY' });
  });
});

describe('check-in domain service', () => {
  it('uses Asia/Jakarta server date and time, accepts boundary accuracy, and snapshots the result', async () => {
    const repository = new FakeAttendanceRepository();
    const service = serviceAt(repository, '2026-08-25T00:05:59.000Z');

    const result = await service.checkIn(teacherId, {
      latitude: geofence.latitude,
      longitude: geofence.longitude,
      accuracyMeters: geofence.maxAccuracyMeters,
    });

    expect(result).toMatchObject({
      workDate: '2026-08-25',
      checkInAt: '2026-08-25T00:05:59.000Z',
      distanceMeters: 0,
      arrivalLateMinutes: 5,
      workStart: '07:00',
      targetMinutes: 515,
    });
  });

  it('resolves a Saturday working-day override before selecting its schedule', async () => {
    const repository = new FakeAttendanceRepository();
    repository.calendarException = {
      id: '60000000-0000-4000-8000-000000000001',
      workDate: '2026-08-25',
      exceptionType: 'WORKING_DAY',
      name: 'Hari kerja khusus',
      scheduleType: 'SATURDAY',
    };
    repository.schedule = saturdaySchedule;

    const result = await serviceAt(repository, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 },
    );

    expect(result.targetMinutes).toBe(215);
    expect(result.workEnd).toBe('10:35');
  });

  it('returns the same record before revalidating a repeated request', async () => {
    const repository = new FakeAttendanceRepository();
    const first = await serviceAt(repository, '2026-08-25T00:00:00.000Z').checkIn(
      teacherId,
      { latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 },
    );
    const repeated = await serviceAt(repository, '2026-08-25T10:00:00.000Z').checkIn(
      teacherId,
      { latitude: 0, longitude: 0, accuracyMeters: 999 },
    );

    expect(repeated).toEqual(first);
    expect(repository.saveCount).toBe(1);
  });

  it.each([
    {
      arrange(repository: FakeAttendanceRepository) {
        repository.calendarException = {
          id: '60000000-0000-4000-8000-000000000002',
          workDate: '2026-08-25',
          exceptionType: 'HOLIDAY' as const,
          name: 'Libur sekolah',
          scheduleType: null,
        };
      },
      code: 'NOT_A_WORKING_DAY',
    },
    {
      arrange(repository: FakeAttendanceRepository) {
        repository.schedule = null;
      },
      code: 'SCHEDULE_NOT_CONFIGURED',
    },
    {
      arrange(repository: FakeAttendanceRepository) {
        repository.geofence = null;
      },
      code: 'GEOFENCE_NOT_CONFIGURED',
    },
    {
      arrange(repository: FakeAttendanceRepository) {
        repository.approvedLeave = true;
      },
      code: 'ALREADY_HAS_APPROVED_LEAVE',
    },
  ])('rejects $code with a structured domain error', async ({ arrange, code }) => {
    const repository = new FakeAttendanceRepository();
    arrange(repository);

    await expect(
      serviceAt(repository, '2026-08-25T00:00:00.000Z').checkIn(teacherId, {
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: 10,
      }),
    ).rejects.toMatchObject({ code } satisfies Partial<AppError>);
  });

  it('rejects outside-window, inaccurate, and outside-radius locations separately', async () => {
    const outsideWindowRepository = new FakeAttendanceRepository();
    await expect(
      serviceAt(outsideWindowRepository, '2026-08-24T22:29:59.000Z').checkIn(
        teacherId,
        { latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 },
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_ATTENDANCE_WINDOW' });

    const inaccurateRepository = new FakeAttendanceRepository();
    await expect(
      serviceAt(inaccurateRepository, '2026-08-25T00:00:00.000Z').checkIn(
        teacherId,
        { latitude: -6.2, longitude: 106.816666, accuracyMeters: 50.01 },
      ),
    ).rejects.toMatchObject({ code: 'LOCATION_INACCURATE' });

    const outsideRadiusRepository = new FakeAttendanceRepository();
    await expect(
      serviceAt(outsideRadiusRepository, '2026-08-25T00:00:00.000Z').checkIn(
        teacherId,
        { latitude: -6.19, longitude: 106.816666, accuracyMeters: 10 },
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_GEOFENCE' });
  });

  it('exposes explicit today states without exposing geofence coordinates', async () => {
    const readyRepository = new FakeAttendanceRepository();
    const ready = await serviceAt(
      readyRepository,
      '2026-08-25T00:00:00.000Z',
    ).getToday(teacherId);

    expect(ready.state).toBe('READY_TO_CHECK_IN');
    expect(ready.schedule).toMatchObject({ scheduleType: 'WEEKDAY' });
    expect(ready.locationRequirement).toEqual({ maxAccuracyMeters: 50 });
    expect(ready).not.toHaveProperty('geofence');

    readyRepository.calendarException = {
      id: '60000000-0000-4000-8000-000000000003',
      workDate: '2026-08-25',
      exceptionType: 'HOLIDAY',
      name: 'Libur sekolah',
      scheduleType: null,
    };
    const holiday = await serviceAt(
      readyRepository,
      '2026-08-25T00:00:00.000Z',
    ).getToday(teacherId);
    expect(holiday).toMatchObject({ state: 'NON_WORKING_DAY', schedule: null });
  });
});
