import type { AuthUser, SecurityGuardDashboardResponse } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { SecurityDashboardService } from './security-dashboard.js';

const guard: AuthUser = { id: '22222222-2222-4222-8222-222222222222', nip: 'satpam1', fullName: 'Wahid', role: 'SECURITY_GUARD', isActive: true, mustChangePassword: false };
const response: SecurityGuardDashboardResponse = {
  serverNow: '2026-09-07T00:00:00.000Z', calendarDate: '2026-09-07',
  currentDuty: { workDate: '2026-09-07', rotationDay: 1, status: 'NIGHT', scheduleType: 'SECURITY_NIGHT', targetMinutes: 720, boundaries: null },
  activeDuty: null, activeAttendance: null, latestAttendance: null, nextWorkingDuty: null, locationRequirement: null,
};

class FakeAuth implements AuthService {
  constructor(readonly user: AuthUser) {}
  async authenticate() { return this.user; }
  async login(): Promise<SessionResult> { throw new Error('not used'); }
  async refresh(): Promise<SessionResult> { throw new Error('not used'); }
  async changePassword(): Promise<SessionResult> { throw new Error('not used'); }
  async logout() {}
}

describe('Satpam dashboard HTTP API', () => {
  it('returns the dedicated dashboard only to SECURITY_GUARD', async () => {
    const service: SecurityDashboardService = { getDashboard: async () => response };
    const allowed = await request(createApp({ authService: new FakeAuth(guard), securityDashboardService: service }))
      .get('/api/security-guard/dashboard')
      .set('Cookie', 'absensi_session=token');
    const denied = await request(createApp({ authService: new FakeAuth({ ...guard, role: 'USER' }), securityDashboardService: service }))
      .get('/api/security-guard/dashboard')
      .set('Cookie', 'absensi_session=token');

    expect(allowed.status).toBe(200);
    expect(allowed.body.currentDuty.status).toBe('NIGHT');
    expect(denied.status).toBe(403);
  });
});
