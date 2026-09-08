import type {
  AdminAttendanceListResponse,
  AttendanceAdminNote,
  AuthUser,
  CreateAttendanceAdminNote,
  ListAdminAttendanceQuery,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { AdminAttendanceService } from './admin-attendance.js';
import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';

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
const attendanceId = '40000000-0000-4000-8000-000000000001';
const note: AttendanceAdminNote = {
  id: '60000000-0000-4000-8000-000000000001',
  attendanceId,
  note: 'Dokumen sudah diperiksa',
  createdBy: admin.id,
  createdByFullName: admin.fullName,
  createdAt: '2026-08-25T10:05:00.000Z',
};
const response: AdminAttendanceListResponse = {
  summary: {
    workDate: '2026-08-25',
    generatedAt: '2026-08-25T01:00:00.000Z',
    present: 1,
    late: 0,
    notPresent: 0,
    incomplete: 0,
    leave: 0,
    off: 0,
    total: 1,
  },
  data: [
    {
      teacherId: teacher.id,
      teacherNip: '1987001',
      teacherFullName: 'Guru Satu',
      workDate: '2026-08-25',
      status: 'PRESENT',
      attendanceId,
      checkInAt: '2026-08-25T00:00:00.000Z',
      checkOutAt: null,
      workedMinutes: null,
      workDeficitMinutes: null,
      arrivalLateMinutes: 0,
      leaveType: null,
      notes: [],
    },
  ],
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  },
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

class FakeAdminAttendanceService implements AdminAttendanceService {
  listCalls: ListAdminAttendanceQuery[] = [];
  noteCalls: Array<{
    actorId: string;
    attendanceId: string;
    input: CreateAttendanceAdminNote;
  }> = [];

  async list(input: ListAdminAttendanceQuery) {
    this.listCalls.push(input);
    return response;
  }

  async addNote(
    actorId: string,
    recordId: string,
    input: CreateAttendanceAdminNote,
  ) {
    this.noteCalls.push({ actorId, attendanceId: recordId, input });
    return note;
  }
}

function testApp(user: AuthUser) {
  const adminAttendanceService = new FakeAdminAttendanceService();
  return {
    adminAttendanceService,
    app: createApp({
      authService: new FakeAuthService(user),
      adminAttendanceService,
    }),
  };
}

describe('admin attendance HTTP API', () => {
  it('allows SuperAdmin to filter the paginated daily monitoring table', async () => {
    const { app, adminAttendanceService } = testApp(admin);

    const result = await request(app)
      .get(
        '/api/admin/attendance?workDate=2026-08-25&status=LATE&search=Guru&page=2&pageSize=10',
      )
      .set('Cookie', 'absensi_access=token');

    expect(result.status).toBe(200);
    expect(adminAttendanceService.listCalls).toEqual([
      {
        workDate: '2026-08-25',
        status: 'LATE',
        search: 'Guru',
        page: 2,
        pageSize: 10,
      },
    ]);
    expect(result.body.summary.total).toBe(1);
  });

  it('allows SuperAdmin to append a note and rejects correction fields', async () => {
    const { app, adminAttendanceService } = testApp(admin);

    const valid = await request(app)
      .post(`/api/admin/attendance/${attendanceId}/notes`)
      .set('Cookie', 'absensi_access=token')
      .send({ note: 'Dokumen sudah diperiksa' });
    const correction = await request(app)
      .post(`/api/admin/attendance/${attendanceId}/notes`)
      .set('Cookie', 'absensi_access=token')
      .send({
        note: 'Koreksi waktu',
        checkInAt: '2026-08-25T00:01:00.000Z',
      });

    expect(valid.status).toBe(201);
    expect(valid.body.note).toEqual(note);
    expect(correction.status).toBe(400);
    expect(adminAttendanceService.noteCalls).toEqual([
      {
        actorId: admin.id,
        attendanceId,
        input: { note: 'Dokumen sudah diperiksa' },
      },
    ]);
  });

  it('enforces the SuperAdmin role and validates attendance IDs', async () => {
    const teacherApp = testApp(teacher).app;
    const adminApp = testApp(admin).app;

    const denied = await request(teacherApp)
      .get('/api/admin/attendance')
      .set('Cookie', 'absensi_access=token');
    const invalidId = await request(adminApp)
      .post('/api/admin/attendance/bukan-uuid/notes')
      .set('Cookie', 'absensi_access=token')
      .send({ note: 'Tidak tersimpan' });

    expect(denied.status).toBe(403);
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.code).toBe('VALIDATION_ERROR');
  });
});
