import type { AuthUser } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { StaffDashboardService } from './staff-dashboard.js';

class FakeAuth implements AuthService {
  constructor(private readonly user: AuthUser) {}
  async authenticate() { return this.user; }
  async login(): Promise<SessionResult> { throw new Error('not used'); }
  async refresh(): Promise<SessionResult> { throw new Error('not used'); }
  async changePassword(): Promise<SessionResult> { throw new Error('not used'); }
  async logout() {}
}
const baseUser: AuthUser = { id: '11111111-1111-4111-8111-111111111111', nip: '1', fullName: 'Rani', role: 'USER', isActive: true, mustChangePassword: false };

describe('staff dashboard HTTP API', () => {
  it.each(['USER', 'SECURITY_GUARD'] as const)('allows %s and passes validated filters', async (role) => {
    const get = vi.fn(async () => ({ ok: true }) as never);
    const response = await request(createApp({ authService: new FakeAuth({ ...baseUser, role }), staffDashboardService: { get } }))
      .get('/api/dashboard?month=2026-09&page=2&pageSize=5&type=LEAVE')
      .set('Cookie', 'absensi_session=token');
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ role }), { month: '2026-09', page: 2, pageSize: 5, type: 'LEAVE' });
  });

  it('rejects SuperAdmin and malformed months', async () => {
    const service: StaffDashboardService = { get: async () => ({ ok: true }) as never };
    const denied = await request(createApp({ authService: new FakeAuth({ ...baseUser, role: 'SUPER_ADMIN' }), staffDashboardService: service }))
      .get('/api/dashboard?month=2026-09').set('Cookie', 'absensi_session=token');
    const invalid = await request(createApp({ authService: new FakeAuth(baseUser), staffDashboardService: service }))
      .get('/api/dashboard?month=09-2026').set('Cookie', 'absensi_session=token');
    expect(denied.status).toBe(403);
    expect(invalid.status).toBe(400);
  });
});
