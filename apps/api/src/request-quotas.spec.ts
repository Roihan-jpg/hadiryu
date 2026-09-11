import type { AuthUser, RequestQuotaResponse } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import {
  countLateArrivalQuotaRows,
  createRequestQuotaService,
  type RequestQuotaRepository,
  type RequestQuotaService,
} from './request-quotas.js';

const user: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Satu',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

class FakeAuthService implements AuthService {
  constructor(private readonly authenticatedUser: AuthUser) {}
  async authenticate(): Promise<AuthUser> { return this.authenticatedUser; }
  async login(): Promise<SessionResult> { throw new Error('not used'); }
  async refresh(): Promise<SessionResult> { throw new Error('not used'); }
  async changePassword(): Promise<SessionResult> { throw new Error('not used'); }
  async logout(): Promise<void> {}
}

class FakeQuotaRepository implements RequestQuotaRepository {
  calls: Array<{ teacherId: string; startDate: string; endDate: string }> = [];
  async countActive(teacherId: string, startDate: string, endDate: string) {
    this.calls.push({ teacherId, startDate, endDate });
    return { lateArrival: 1, earlyDeparture: 2 };
  }
}

describe('request quota service and HTTP API', () => {
  it('counts late-arrival rows without requiring a database enum filter', () => {
    expect(countLateArrivalQuotaRows([
      { leave_type: 'SICK' },
      { leave_type: 'LATE_ARRIVAL' },
      { leave_type: 'OFFICIAL_DUTY' },
    ])).toBe(1);
  });

  it('uses calendar-date boundaries and returns separate remaining quotas', async () => {
    const repository = new FakeQuotaRepository();
    const service = createRequestQuotaService(repository);

    await expect(service.get(user.id, { month: '2026-12' })).resolves.toEqual({
      month: '2026-12',
      lateArrival: { limit: 2, used: 1, remaining: 1 },
      earlyDeparture: { limit: 2, used: 2, remaining: 0 },
    });
    expect(repository.calls).toEqual([{
      teacherId: user.id,
      startDate: '2026-12-01',
      endDate: '2027-01-01',
    }]);
  });

  it('exposes quota only to self-service roles and validates the month', async () => {
    const response: RequestQuotaResponse = {
      month: '2026-09',
      lateArrival: { limit: 2, used: 1, remaining: 1 },
      earlyDeparture: { limit: 2, used: 0, remaining: 2 },
    };
    const quotaService: RequestQuotaService = { async get() { return response; } };
    const app = createApp({
      authService: new FakeAuthService(user),
      requestQuotaService: quotaService,
    });

    const valid = await request(app)
      .get('/api/request-quotas?month=2026-09')
      .set('Cookie', 'absensi_session=token');
    const invalid = await request(app)
      .get('/api/request-quotas?month=2026-13')
      .set('Cookie', 'absensi_session=token');

    expect(valid.status).toBe(200);
    expect(valid.body).toEqual(response);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });
});
