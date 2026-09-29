import type { AuthUser } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AttendanceService } from './attendance.js';
import { AppError, type AuthService, type SessionResult } from './auth.js';
import {
  createStructuredLogger,
  type AppLogRecord,
  type AppLogger,
} from './observability.js';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000013',
  nip: '1987013',
  fullName: 'Guru Security',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

class MemoryLogger implements AppLogger {
  readonly records: AppLogRecord[] = [];

  info(record: AppLogRecord): void {
    this.records.push(record);
  }

  error(record: AppLogRecord): void {
    this.records.push(record);
  }
}

class FakeAuthService implements AuthService {
  loginError: Error | null = null;

  async login(): Promise<SessionResult> {
    if (this.loginError) throw this.loginError;
    return this.session();
  }

  async refresh(): Promise<SessionResult> {
    return this.session();
  }

  async authenticate(): Promise<AuthUser> {
    return teacher;
  }

  async changePassword(): Promise<SessionResult> {
    return this.session();
  }

  async logout(): Promise<void> {}

  private session(): SessionResult {
    return {
      user: teacher,
      accessToken: 'access-token-that-must-not-be-logged',
      refreshToken: 'refresh-token-that-must-not-be-logged',
      expiresIn: 3600,
    };
  }
}

const attendanceResult = {
  id: '40000000-0000-4000-8000-000000000013',
  workDate: '2026-08-26',
  checkInAt: '2026-08-26T00:00:00.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 0,
  status: 'CHECKED_IN' as const,
};

const attendanceService: AttendanceService = {
  async getToday() {
    throw new Error('not used');
  },
  async checkIn() {
    return attendanceResult;
  },
  async checkout() {
    throw new Error('not used');
  },
  async history() {
    throw new Error('not used');
  },
};

const productionSecurity = {
  production: true,
  allowedOrigins: ['https://absensi.example.sch.id'],
  authRateLimit: { windowMs: 60_000, max: 20 },
  attendanceRateLimit: { windowMs: 60_000, max: 20 },
} as const;

describe('security audit HTTP baseline', () => {
  it('adds a validated request ID and logs only structured request metadata', async () => {
    const logger = new MemoryLogger();
    const response = await request(createApp({ logger }))
      .get('/api/auth/me')
      .set('X-Request-ID', 'req_security-13')
      .set('Cookie', 'absensi_session=secret-cookie');

    expect(response.status).toBe(500);
    expect(response.headers['x-request-id']).toBe('req_security-13');
    expect(logger.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'http.request.completed',
          requestId: 'req_security-13',
          method: 'GET',
          endpoint: '/api/auth/me',
          status: 500,
        }),
      ]),
    );
    const serialized = JSON.stringify(logger.records);
    expect(serialized).not.toContain('secret-cookie');
    expect(serialized).not.toContain('cookie');
  });

  it('replaces an invalid request ID and never leaks request secrets or upstream errors', async () => {
    const logger = new MemoryLogger();
    const authService = new FakeAuthService();
    authService.loginError = new AppError(
      500,
      'UPSTREAM_AUTH_FAILED',
      'database password=server-secret token=upstream-token',
      { refreshToken: 'upstream-token' },
    );

    const response = await request(createApp({ authService, logger }))
      .post('/api/auth/login')
      .set('X-Request-ID', 'invalid request id with spaces')
      .send({ nip: '1987013', password: 'Submit12' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan pada server',
      },
    });
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const serialized = JSON.stringify(logger.records);
    expect(serialized).not.toContain('Submit12');
    expect(serialized).not.toContain('server-secret');
    expect(serialized).not.toContain('upstream-token');
    expect(logger.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'http.request.failed',
          errorName: 'Error',
          internalErrorCode: 'UPSTREAM_AUTH_FAILED',
        }),
      ]),
    );
  });

  it('redacts sensitive fields if an application log record contains them', () => {
    const lines: string[] = [];
    const logger = createStructuredLogger((line) => lines.push(line));

    logger.info({
      event: 'security.test',
      password: 'password-value',
      nested: { refreshToken: 'refresh-value', safe: 'visible' },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('password-value');
    expect(lines[0]).not.toContain('refresh-value');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: 'security.test',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', safe: 'visible' },
    });
  });

  it('enforces production headers, explicit CORS, CSRF, and secure cookies', async () => {
    const app = createApp({
      authService: new FakeAuthService(),
      security: productionSecurity,
      secureCookies: true,
    });

    const rejectedOrigin = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(rejectedOrigin.status).toBe(403);
    expect(rejectedOrigin.body.error.code).toBe('CORS_ORIGIN_FORBIDDEN');

    const rejectedCsrf = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://absensi.example.sch.id')
      .send({ nip: '1987013', password: 'Valid123' });
    expect(rejectedCsrf.status).toBe(403);
    expect(rejectedCsrf.body.error.code).toBe('CSRF_PROTECTION_REQUIRED');

    const accepted = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://absensi.example.sch.id')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ nip: '1987013', password: 'Valid123' });

    expect(accepted.status).toBe(200);
    expect(accepted.headers['access-control-allow-origin']).toBe(
      'https://absensi.example.sch.id',
    );
    expect(accepted.headers['access-control-allow-credentials']).toBe('true');
    expect(accepted.headers['x-content-type-options']).toBe('nosniff');
    expect(accepted.headers['x-frame-options']).toBe('DENY');
    expect(accepted.headers['referrer-policy']).toBe('no-referrer');
    expect(accepted.headers['x-powered-by']).toBeUndefined();
    expect(accepted.headers['set-cookie']).toEqual([
      expect.stringMatching(/^absensi_session=.*;.*HttpOnly.*Secure.*SameSite=Strict/i),
    ]);
  });

  it('rate limits authentication with a safe structured 429 response', async () => {
    const logger = new MemoryLogger();
    const app = createApp({
      authService: new FakeAuthService(),
      logger,
      security: {
        ...productionSecurity,
        authRateLimit: { windowMs: 60_000, max: 1 },
      },
    });
    const sendLogin = () =>
      request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://absensi.example.sch.id')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ nip: '1987013', password: 'Rate1234' });

    expect((await sendLogin()).status).toBe(200);
    const limited = await sendLogin();

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Terlalu banyak permintaan. Silakan coba lagi nanti',
      },
    });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(JSON.stringify(logger.records)).not.toContain('Rate1234');
  });

  it('rate limits attendance writes without calling the domain service again', async () => {
    let calls = 0;
    const countedAttendanceService: AttendanceService = {
      ...attendanceService,
      async checkIn() {
        calls += 1;
        return attendanceResult;
      },
    };
    const app = createApp({
      attendanceService: countedAttendanceService,
      authService: new FakeAuthService(),
      security: {
        ...productionSecurity,
        attendanceRateLimit: { windowMs: 60_000, max: 1 },
      },
    });
    const checkIn = () =>
      request(app)
        .post('/api/attendance/check-in')
        .set('Origin', 'https://absensi.example.sch.id')
        .set('X-Requested-With', 'XMLHttpRequest')
        .set('Cookie', 'absensi_session=access-token')
        .send({ latitude: -6.2, longitude: 106.816666, accuracyMeters: 10 });

    expect((await checkIn()).status).toBe(200);
    const limited = await checkIn();

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(calls).toBe(1);
  });

  it('returns a generic forbidden response when a USER accesses an admin route', async () => {
    const response = await request(
      createApp({ authService: new FakeAuthService() }),
    )
      .get('/api/admin/teachers')
      .set('Cookie', 'absensi_session=access-token');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: { code: 'ROLE_FORBIDDEN', message: 'Anda tidak memiliki akses' },
    });
    expect(JSON.stringify(response.body)).not.toContain(teacher.id);
  });
});
