import type {
  AuthUser,
  CheckInRecord,
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { AppError, type AuthService, type SessionResult } from './auth.js';
import type { AttendanceService } from './attendance.js';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Tujuh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

const attendance: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:00:00.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 0,
  status: 'CHECKED_IN',
};

const today: TodayAttendanceResponse = {
  serverNow: '2026-08-25T00:00:00.000Z',
  workDate: '2026-08-25',
  state: 'READY_TO_CHECK_IN',
  schedule: {
    scheduleType: 'WEEKDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '12:00',
    workEnd: '15:35',
    checkoutClose: '17:00',
    targetMinutes: 515,
  },
  attendance: null,
};

class FakeAuthService implements AuthService {
  authenticatedUser = teacher;

  async authenticate(): Promise<AuthUser> {
    return this.authenticatedUser;
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
  checkInCalls: Array<{ teacherId: string; location: LocationInput }> = [];
  checkInError: AppError | null = null;

  async getToday(): Promise<TodayAttendanceResponse> {
    return today;
  }

  async checkIn(teacherId: string, location: LocationInput): Promise<CheckInRecord> {
    if (this.checkInError) throw this.checkInError;
    this.checkInCalls.push({ teacherId, location });
    return attendance;
  }

  async checkout(): Promise<never> {
    throw new Error('not used');
  }

  async history(): Promise<never> {
    throw new Error('not used');
  }
}

function testApp(authService = new FakeAuthService()) {
  const attendanceService = new FakeAttendanceService();
  return {
    app: createApp({ authService, attendanceService }),
    attendanceService,
  };
}

describe('check-in HTTP API', () => {
  it('requires an authenticated USER with the initial password changed', async () => {
    const anonymous = await request(testApp().app).get('/api/attendance/today');
    const adminAuth = new FakeAuthService();
    adminAuth.authenticatedUser = { ...teacher, role: 'SUPER_ADMIN' };
    const forbidden = await request(testApp(adminAuth).app)
      .post('/api/attendance/check-in')
      .set('Cookie', 'absensi_session=access-token')
      .send({ latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 });

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('returns the dashboard state from server-resolved today', async () => {
    const response = await request(testApp().app)
      .get('/api/attendance/today')
      .set('Cookie', 'absensi_session=access-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(today);
  });

  it('accepts only LocationInput and never a browser timestamp', async () => {
    const { app, attendanceService } = testApp();
    const invalid = await request(app)
      .post('/api/attendance/check-in')
      .set('Cookie', 'absensi_session=access-token')
      .send({
        latitude: -6.2,
        longitude: 106.816666,
        accuracyMeters: 10,
        checkInAt: '2020-01-01T00:00:00.000Z',
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    expect(attendanceService.checkInCalls).toHaveLength(0);
  });

  it('passes the authenticated teacher and location to an idempotent service', async () => {
    const { app, attendanceService } = testApp();
    const input = { latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 };
    const first = await request(app)
      .post('/api/attendance/check-in')
      .set('Cookie', 'absensi_session=access-token')
      .send(input);
    const repeated = await request(app)
      .post('/api/attendance/check-in')
      .set('Cookie', 'absensi_session=access-token')
      .send(input);

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual(first.body);
    expect(attendanceService.checkInCalls).toEqual([
      { teacherId: teacher, location: input },
      { teacherId: teacher, location: input },
    ]);
  });

  it('serializes every domain rejection with the common API error shape', async () => {
    const { app, attendanceService } = testApp();
    attendanceService.checkInError = new AppError(
      422,
      'OUTSIDE_GEOFENCE',
      'Anda berada di luar radius sekolah',
      { distanceMeters: 120, radiusMeters: 100 },
    );
    const response = await request(app)
      .post('/api/attendance/check-in')
      .set('Cookie', 'absensi_session=access-token')
      .send({ latitude: -6.19, longitude: 106.816666, accuracyMeters: 10 });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: {
        code: 'OUTSIDE_GEOFENCE',
        message: 'Anda berada di luar radius sekolah',
        details: { distanceMeters: 120, radiusMeters: 100 },
      },
    });
  });
});
