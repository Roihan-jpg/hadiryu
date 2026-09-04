import type {
  AdminEarlyDepartureRequestListResponse,
  AuthUser,
  EarlyDepartureRequest,
  EarlyDepartureRequestListResponse,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { EarlyDepartureRequestService } from './early-departure-requests.js';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Satu',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};
const admin: AuthUser = {
  ...teacher,
  id: '50000000-0000-4000-8000-000000000002',
  nip: 'ADMIN',
  fullName: 'Admin',
  role: 'SUPER_ADMIN',
};
const pending: EarlyDepartureRequest = {
  id: '40000000-0000-4000-8000-000000000001',
  attendanceId: '40000000-0000-4000-8000-000000000002',
  teacherId: teacher.id,
  workDate: '2026-08-31',
  requestedAt: '2026-08-31T06:00:00.000Z',
  reason: 'Keperluan keluarga',
  latitude: -8.1328,
  longitude: 113.2219,
  accuracyMeters: 10,
  distanceMeters: 0,
  status: 'PENDING',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-31T06:00:00.000Z',
  updatedAt: '2026-08-31T06:00:00.000Z',
};

class FakeAuthService implements AuthService {
  authenticatedUser: AuthUser = teacher;
  async login(): Promise<SessionResult> { throw new Error('not used'); }
  async refresh(): Promise<SessionResult> { throw new Error('not used'); }
  async authenticate(): Promise<AuthUser> { return this.authenticatedUser; }
  async changePassword(): Promise<SessionResult> { throw new Error('not used'); }
  async logout() {}
}

class FakeService implements EarlyDepartureRequestService {
  createdFor?: string;
  approvedBy?: string;
  async create(teacherId: string) {
    this.createdFor = teacherId;
    return pending;
  }
  async listOwn(): Promise<EarlyDepartureRequestListResponse> {
    return { data: [pending], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };
  }
  async listAdmin(): Promise<AdminEarlyDepartureRequestListResponse> {
    return {
      data: [{ ...pending, teacherNip: teacher.nip, teacherFullName: teacher.fullName }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    };
  }
  async getAdmin() {
    return {
      earlyDepartureRequest: { ...pending, teacherNip: teacher.nip, teacherFullName: teacher.fullName },
      attendanceTimeline: [],
    };
  }
  async approve(actorId: string) {
    this.approvedBy = actorId;
    return { ...pending, status: 'APPROVED' as const, decidedBy: actorId, decidedAt: pending.createdAt };
  }
  async reject(actorId: string) {
    return { ...pending, status: 'REJECTED' as const, decidedBy: actorId, decidedAt: pending.createdAt };
  }
}

describe('early departure request HTTP API', () => {
  it('creates a teacher request and lets only an admin decide it', async () => {
    const authService = new FakeAuthService();
    const service = new FakeService();
    const app = createApp({ authService, earlyDepartureRequestService: service });

    const created = await request(app)
      .post('/api/early-departure-requests')
      .set('Cookie', 'absensi_access=access-token')
      .send({
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
      });
    expect(created.status).toBe(201);
    expect(service.createdFor).toBe(teacher.id);

    const forbidden = await request(app)
      .post(`/api/admin/early-departure-requests/${pending.id}/approve`)
      .set('Cookie', 'absensi_access=access-token')
      .send({});
    expect(forbidden.status).toBe(403);

    authService.authenticatedUser = admin;
    const approved = await request(app)
      .post(`/api/admin/early-departure-requests/${pending.id}/approve`)
      .set('Cookie', 'absensi_access=access-token')
      .send({ decisionNote: 'Disetujui' });
    expect(approved.status).toBe(200);
    expect(service.approvedBy).toBe(admin.id);
  });
});
