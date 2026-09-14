import type {
  AdminEarlyDepartureRequest,
  EarlyDepartureRequest,
  GeofenceRule,
  ScheduleRule,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import type { PersistedAttendanceRecord } from './attendance.js';
import {
  createEarlyDepartureRequestService,
  type EarlyDepartureRequestRepository,
} from './early-departure-requests.js';

const teacherId = '50000000-0000-4000-8000-000000000001';
const adminId = '50000000-0000-4000-8000-000000000002';
const requestId = '40000000-0000-4000-8000-000000000001';
const attendance: PersistedAttendanceRecord = {
  id: '40000000-0000-4000-8000-000000000002',
  workDate: '2026-08-31',
  checkInAt: '2026-08-31T00:00:00.000Z',
  latitude: -8.1328,
  longitude: 113.2219,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 0,
  scheduleType: 'WEEKDAY',
  status: 'CHECKED_IN',
};
const geofence: GeofenceRule = {
  shape: 'CIRCLE',
  id: '30000000-0000-4000-8000-000000000001',
  latitude: -8.1328,
  longitude: 113.2219,
  radiusMeters: 100,
  maxAccuracyMeters: 50,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};
const schedule: ScheduleRule = {
  id: '30000000-0000-4000-8000-000000000002',
  scheduleType: 'WEEKDAY',
  checkInOpen: '05:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '14:30',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  effectiveFrom: '2026-08-31',
  effectiveTo: null,
};
const pending: EarlyDepartureRequest = {
  id: requestId,
  attendanceId: attendance.id,
  teacherId,
  workDate: attendance.workDate,
  requestedAt: '2026-08-31T06:00:00.000Z',
  reason: 'Keperluan keluarga',
  latitude: geofence.latitude,
  longitude: geofence.longitude,
  accuracyMeters: 10,
  distanceMeters: 0,
  status: 'PENDING',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-31T06:00:00.000Z',
  updatedAt: '2026-08-31T06:00:00.000Z',
};

class FakeRepository implements EarlyDepartureRequestRepository {
  attendance: PersistedAttendanceRecord | null = attendance;
  geofence: GeofenceRule | null = geofence;
  schedule: ScheduleRule | null = schedule;
  request: EarlyDepartureRequest | null = pending;

  async findAttendance() { return this.attendance; }
  async findGeofence() { return this.geofence; }
  async findSchedule() { return this.schedule; }
  async create(): Promise<EarlyDepartureRequest> { return pending; }
  async findOwn() { return this.request; }
  async listOwn() { return { records: this.request ? [this.request] : [], totalItems: this.request ? 1 : 0 }; }
  async findAny(): Promise<AdminEarlyDepartureRequest | null> {
    return this.request
      ? { ...this.request, teacherNip: '1987001', teacherFullName: 'Guru Satu' }
      : null;
  }
  async findTimeline() { return []; }
  async listAdmin() { return { records: [], totalItems: 0 }; }
  async decide(_id: string, actorId: string, status: 'APPROVED' | 'REJECTED') {
    return {
      ...pending,
      status,
      decidedBy: actorId,
      decidedAt: '2026-08-31T07:00:00.000Z',
    } as EarlyDepartureRequest;
  }
}

function service(repository = new FakeRepository(), now = '2026-08-31T06:00:00.000Z') {
  return createEarlyDepartureRequestService(repository, () => new Date(now));
}

describe('early departure request service', () => {
  it('creates a request only for an active attendance before work end', async () => {
    await expect(
      service().create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
      }),
    ).resolves.toMatchObject({ status: 'PENDING', attendanceId: attendance.id });

    const missing = new FakeRepository();
    missing.attendance = null;
    await expect(
      service(missing).create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
      }),
    ).rejects.toMatchObject({ code: 'CHECK_IN_REQUIRED' });

    await expect(
      service(new FakeRepository(), '2026-08-31T08:36:00.000Z').create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_EARLY_DEPARTURE' });
  });

  it('uses the latest Guru work-end time instead of the check-in snapshot', async () => {
    const repository = new FakeRepository();
    repository.attendance = { ...attendance, workEnd: '08:00', targetMinutes: 120 };
    repository.schedule = { ...schedule, checkoutOpen: '08:30', workEnd: '10:00', checkoutClose: '11:00', targetMinutes: 185 };

    await expect(
      service(repository, '2026-08-31T02:00:00.000Z').create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects inaccurate and out-of-geofence locations', async () => {
    await expect(
      service().create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 100,
      }),
    ).rejects.toMatchObject({ code: 'LOCATION_INACCURATE' });
    await expect(
      service().create(teacherId, {
        reason: 'Keperluan keluarga',
        latitude: -7,
        longitude: 113.2219,
        accuracyMeters: 10,
      }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_GEOFENCE' });
  });

  it('approves or rejects only a Pending request', async () => {
    await expect(
      service().approve(adminId, requestId, { decisionNote: 'Disetujui' }),
    ).resolves.toMatchObject({ status: 'APPROVED', decidedBy: adminId });

    const decided = new FakeRepository();
    decided.request = { ...pending, status: 'REJECTED', decidedBy: adminId, decidedAt: pending.createdAt };
    await expect(
      service(decided).reject(adminId, requestId, {}),
    ).rejects.toMatchObject({ code: 'EARLY_DEPARTURE_NOT_PENDING' });
  });
});
