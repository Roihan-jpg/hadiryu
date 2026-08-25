import type {
  AttendanceHistoryResponse,
  AttendanceRecord,
  AuthUser,
  CompletedAttendanceRecord,
  ListAttendanceHistoryQuery,
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AttendanceService } from './attendance.js';
import type { AuthService, SessionResult } from './auth.js';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Delapan',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};
const completed: CompletedAttendanceRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:20.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 5,
  checkOutAt: '2026-08-25T08:35:59.000Z',
  checkOutLatitude: -6.2,
  checkOutLongitude: 106.816666,
  checkOutAccuracyMeters: 10,
  checkOutDistanceMeters: 0,
  workedMinutes: 510,
  workDeficitMinutes: 5,
  status: 'COMPLETED',
};

class FakeAuthService implements AuthService {
  async authenticate(): Promise<AuthUser> {
    return teacher;
  }
  async login(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async refresh(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async changePassword(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async logout(): Promise<void> {}
}

class FakeAttendanceService implements AttendanceService {
  checkoutCalls: Array<{ teacherId: string; location: LocationInput }> = [];
  historyCalls: Array<{
    teacherId: string;
    input: ListAttendanceHistoryQuery;
  }> = [];

  async getToday(): Promise<TodayAttendanceResponse> {
    return {
      serverNow: completed.checkOutAt,
      workDate: completed.workDate,
      state: 'COMPLETED',
      schedule: null,
      attendance: completed,
    };
  }

  async checkIn(): Promise<AttendanceRecord> {
    return completed;
  }

  async checkout(
    teacherId: string,
    location: LocationInput,
  ): Promise<CompletedAttendanceRecord> {
    this.checkoutCalls.push({ teacherId, location });
    return completed;
  }

  async history(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<AttendanceHistoryResponse> {
    this.historyCalls.push({ teacherId, input });
    return {
      data: [completed],
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: 1,
        totalPages: 1,
      },
    };
  }
}

function testApp() {
  const attendanceService = new FakeAttendanceService();
  return {
    app: createApp({
      authService: new FakeAuthService(),
      attendanceService,
    }),
    attendanceService,
  };
}

describe('checkout and attendance history HTTP API', () => {
  it('accepts only location data for checkout', async () => {
    const { app, attendanceService } = testApp();
    const response = await request(app)
      .post('/api/attendance/checkout')
      .set('Cookie', 'absensi_access=access-token')
      .send({
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: 10,
        checkOutAt: '2020-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(attendanceService.checkoutCalls).toHaveLength(0);
  });

  it('passes the authenticated teacher and location to checkout', async () => {
    const { app, attendanceService } = testApp();
    const input = { latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 };
    const response = await request(app)
      .post('/api/attendance/checkout')
      .set('Cookie', 'absensi_access=access-token')
      .send(input);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(completed);
    expect(attendanceService.checkoutCalls).toEqual([
      { teacherId: teacher.id, location: input },
    ]);
  });

  it('validates and forwards paginated history filters', async () => {
    const { app, attendanceService } = testApp();
    const response = await request(app)
      .get('/api/attendance/history?page=2&pageSize=10&month=2026-08')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ page: 2, pageSize: 10 });
    expect(attendanceService.historyCalls).toEqual([
      {
        teacherId: teacher.id,
        input: { page: 2, pageSize: 10, month: '2026-08' },
      },
    ]);
  });

  it('rejects an invalid history month before calling the service', async () => {
    const { app, attendanceService } = testApp();
    const response = await request(app)
      .get('/api/attendance/history?month=2026-13')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(attendanceService.historyCalls).toHaveLength(0);
  });
});
