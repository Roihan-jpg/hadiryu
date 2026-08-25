import type {
  AdminLeaveRequest,
  AuthUser,
  LeaveRequest,
  LeaveRequestListResponse,
  ListAdminLeaveRequestsQuery,
  ListLeaveRequestsQuery,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { LeaveRequestService } from './leave-requests.js';

const teacher: AuthUser = { id: '50000000-0000-4000-8000-000000000001', nip: '1987001', fullName: 'Guru Satu', role: 'USER', isActive: true, mustChangePassword: false };
const admin: AuthUser = { ...teacher, id: '50000000-0000-4000-8000-000000000002', role: 'SUPER_ADMIN', fullName: 'Admin' };
const leaveRequest: LeaveRequest = {
  id: '40000000-0000-4000-8000-000000000001', teacherId: teacher.id, leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Perlu berobat', status: 'PENDING', decisionNote: null, decidedBy: null, decidedAt: null, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};

class FakeAuthService implements AuthService {
  constructor(private readonly authenticatedUser: AuthUser) {}
  async authenticate(): Promise<AuthUser> { return this.authenticatedUser; }
  async login(): Promise<SessionResult> { throw new Error('not used'); }
  async refresh(): Promise<SessionResult> { throw new Error('not used'); }
  async changePassword(): Promise<SessionResult> { throw new Error('not used'); }
  async logout(): Promise<void> {}
}
class FakeLeaveRequestService implements LeaveRequestService {
  createCalls: unknown[] = [];
  listOwnCalls: ListLeaveRequestsQuery[] = [];
  listAdminCalls: ListAdminLeaveRequestsQuery[] = [];
  async create(_teacherId: string, input: unknown): Promise<LeaveRequest> { this.createCalls.push(input); return leaveRequest; }
  async listOwn(_teacherId: string, input: ListLeaveRequestsQuery): Promise<LeaveRequestListResponse> { this.listOwnCalls.push(input); return { data: [leaveRequest], pagination: { page: input.page, pageSize: input.pageSize, totalItems: 1, totalPages: 1 } }; }
  async cancel(): Promise<LeaveRequest> { return { ...leaveRequest, status: 'CANCELLED' }; }
  async listAdmin(input: ListAdminLeaveRequestsQuery) { this.listAdminCalls.push(input); return { data: [] as AdminLeaveRequest[], pagination: { page: input.page, pageSize: input.pageSize, totalItems: 0, totalPages: 0 } }; }
  async approve(): Promise<LeaveRequest> { return { ...leaveRequest, status: 'APPROVED', decidedBy: admin.id, decidedAt: '2026-08-25T01:00:00.000Z' }; }
  async reject(): Promise<LeaveRequest> { return { ...leaveRequest, status: 'REJECTED', decidedBy: admin.id, decidedAt: '2026-08-25T01:00:00.000Z' }; }
}
function testApp(user: AuthUser) {
  const leaveRequestService = new FakeLeaveRequestService();
  return { leaveRequestService, app: createApp({ authService: new FakeAuthService(user), leaveRequestService }) };
}

describe('leave requests HTTP API', () => {
  it('accepts a valid teacher request and rejects date ranges before the service', async () => {
    const { app, leaveRequestService } = testApp(teacher);
    const valid = await request(app).post('/api/leave-requests').set('Cookie', 'absensi_access=token').send({ leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Perlu berobat' });
    const invalid = await request(app).post('/api/leave-requests').set('Cookie', 'absensi_access=token').send({ leaveDate: '2026-08-26', leaveEndDate: '2026-08-27', leaveType: 'SICK', reason: 'Perlu berobat' });
    expect(valid.status).toBe(201);
    expect(valid.body.leaveRequest).toMatchObject({ status: 'PENDING' });
    expect(invalid.status).toBe(400);
    expect(leaveRequestService.createCalls).toHaveLength(1);
  });

  it('lists own requests with a status filter and lets only a teacher cancel', async () => {
    const { app, leaveRequestService } = testApp(teacher);
    const result = await request(app).get('/api/leave-requests?page=2&pageSize=10&status=REJECTED').set('Cookie', 'absensi_access=token');
    expect(result.status).toBe(200);
    expect(leaveRequestService.listOwnCalls).toEqual([{ page: 2, pageSize: 10, status: 'REJECTED' }]);
    const adminApp = testApp(admin).app;
    const denied = await request(adminApp).post(`/api/leave-requests/${leaveRequest.id}/cancel`).set('Cookie', 'absensi_access=token').send({});
    expect(denied.status).toBe(403);
  });

  it('allows SuperAdmin to filter, approve, and rejects malformed decisions', async () => {
    const { app, leaveRequestService } = testApp(admin);
    const listed = await request(app).get('/api/admin/leave-requests?status=PENDING&leaveDate=2026-08-26&search=Guru').set('Cookie', 'absensi_access=token');
    const approved = await request(app).post(`/api/admin/leave-requests/${leaveRequest.id}/approve`).set('Cookie', 'absensi_access=token').send({ decisionNote: 'Disetujui' });
    const invalid = await request(app).post(`/api/admin/leave-requests/${leaveRequest.id}/reject`).set('Cookie', 'absensi_access=token').send({ decisionNote: '' });
    expect(listed.status).toBe(200);
    expect(leaveRequestService.listAdminCalls[0]).toMatchObject({ status: 'PENDING', leaveDate: '2026-08-26', search: 'Guru' });
    expect(approved.body.leaveRequest.status).toBe('APPROVED');
    expect(invalid.status).toBe(400);
  });

  it('enforces both role boundaries and validates leave request IDs', async () => {
    const teacherApp = testApp(teacher).app;
    const adminApp = testApp(admin).app;
    const deniedAdminList = await request(teacherApp)
      .get('/api/admin/leave-requests')
      .set('Cookie', 'absensi_access=token');
    const deniedTeacherCreate = await request(adminApp)
      .post('/api/leave-requests')
      .set('Cookie', 'absensi_access=token')
      .send({ leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Sakit' });
    const invalidId = await request(teacherApp)
      .post('/api/leave-requests/bukan-uuid/cancel')
      .set('Cookie', 'absensi_access=token')
      .send({});

    expect(deniedAdminList.status).toBe(403);
    expect(deniedTeacherCreate.status).toBe(403);
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.code).toBe('VALIDATION_ERROR');
  });
});
