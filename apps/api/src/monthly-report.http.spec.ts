import type {
  AuthUser,
  MonthlyReportParams,
  MonthlyReportPreview,
  MonthlyReportReadiness,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { MonthlyReportService } from './monthly-report.js';

const admin: AuthUser = {
  id: '50000000-0000-4000-8000-000000000099',
  nip: 'admin',
  fullName: 'Admin Sekolah',
  role: 'SUPER_ADMIN',
  isActive: true,
  mustChangePassword: false,
};
const teacher: AuthUser = {
  ...admin,
  id: '50000000-0000-4000-8000-000000000001',
  role: 'USER',
};
const preview: MonthlyReportPreview = {
  year: 2026,
  month: 8,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  generatedAt: '2026-09-01T00:00:00.000Z',
  documentStatus: 'FINAL',
  issues: [],
  teachers: [],
};

class FakeAuthService implements AuthService {
  constructor(private readonly user: AuthUser) {}
  async authenticate(): Promise<AuthUser> {
    return this.user;
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

class FakeMonthlyReportService implements MonthlyReportService {
  calls: MonthlyReportParams[] = [];
  readinessCalls: MonthlyReportParams[] = [];
  async readiness(input: MonthlyReportParams): Promise<MonthlyReportReadiness> {
    this.readinessCalls.push(input);
    return {
      status: 'READY_WITH_WARNINGS',
      year: input.year,
      month: input.month,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      issues: [{
        code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
        source: 'SECURITY_SCHEDULE',
        missingRanges: [{ startDate: '2026-09-01', endDate: '2026-09-06' }],
      }],
    };
  }
  async preview(input: MonthlyReportParams): Promise<MonthlyReportPreview> {
    this.calls.push(input);
    return { ...preview, ...input };
  }
}

function testApp(user: AuthUser) {
  const monthlyReportService = new FakeMonthlyReportService();
  return {
    monthlyReportService,
    app: createApp({
      authService: new FakeAuthService(user),
      monthlyReportService,
    }),
  };
}

describe('monthly report preview HTTP API', () => {
  it('returns structured readiness without invoking the preview calculator', async () => {
    const { app, monthlyReportService } = testApp(admin);

    const result = await request(app)
      .get('/api/admin/reports/monthly/2026/9/readiness')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'READY_WITH_WARNINGS',
      issues: [{ code: 'SECURITY_SCHEDULE_COVERAGE_MISSING' }],
    });
    expect(monthlyReportService.readinessCalls).toEqual([{ year: 2026, month: 9 }]);
    expect(monthlyReportService.calls).toEqual([]);
  });

  it('returns a backend-calculated preview to SuperAdmin', async () => {
    const { app, monthlyReportService } = testApp(admin);

    const result = await request(app)
      .get('/api/admin/reports/monthly/2026/8/preview')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(200);
    expect(result.body).toEqual(preview);
    expect(monthlyReportService.calls).toEqual([{ year: 2026, month: 8 }]);
  });

  it('rejects invalid periods before calling the calculator', async () => {
    const { app, monthlyReportService } = testApp(admin);

    const result = await request(app)
      .get('/api/admin/reports/monthly/2026/13/preview')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(monthlyReportService.calls).toEqual([]);
  });

  it('requires the SuperAdmin role', async () => {
    const result = await request(testApp(teacher).app)
      .get('/api/admin/reports/monthly/2026/8/preview')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(403);
  });
});
