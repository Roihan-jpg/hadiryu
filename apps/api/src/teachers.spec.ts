import type {
  AuthUser,
  CreateTeacherRequest,
  ListTeachersQuery,
  PasswordResetResult,
  Teacher,
  UpdateTeacherRequest,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { TeacherService } from './teachers.js';

const admin: AuthUser = {
  id: '6ebefbc7-8bda-4202-8d9e-95441f0acb03',
  nip: 'admin-001',
  fullName: 'Admin Sekolah',
  role: 'SUPER_ADMIN',
  isActive: true,
  mustChangePassword: false,
};

const teacher: Teacher = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '19870001',
  fullName: 'Guru Contoh',
  whatsappNumber: null,
  isActive: true,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: null,
  createdAt: '2026-08-25T01:00:00.000Z',
  updatedAt: '2026-08-25T01:00:00.000Z',
};

class FakeAuthService implements AuthService {
  authenticatedUser = admin;

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

class FakeTeacherService implements TeacherService {
  listInput?: ListTeachersQuery;
  createInput?: CreateTeacherRequest;
  updateInput?: UpdateTeacherRequest;
  action?: string;

  async list(input: ListTeachersQuery) {
    this.listInput = input;
    return {
      data: [teacher],
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        totalItems: 1,
        totalPages: 1,
      },
    };
  }

  async create(_actorId: string, input: CreateTeacherRequest) {
    this.createInput = input;
    return teacher;
  }

  async update(
    _actorId: string,
    _teacherId: string,
    input: UpdateTeacherRequest,
  ) {
    this.updateInput = input;
    return {
      ...teacher,
      ...(input.nip === undefined ? {} : { nip: input.nip }),
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
    };
  }

  async setActive(_actorId: string, _teacherId: string, isActive: boolean) {
    this.action = isActive ? 'activate' : 'deactivate';
    return { ...teacher, isActive };
  }

  async resetPassword(): Promise<PasswordResetResult> {
    this.action = 'reset-password';
    const expiresAt = '2026-08-28T01:00:00.000Z';
    return {
      teacher: {
        ...teacher,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: expiresAt,
      },
      temporaryPassword: 'AG-vA7Qm2pR-2026',
      expiresAt,
    };
  }
}

function testApp(authService = new FakeAuthService()) {
  const teacherService = new FakeTeacherService();
  return {
    app: createApp({ authService, teacherService }),
    teacherService,
  };
}

describe('teacher HTTP API', () => {
  it('requires an authenticated SUPER_ADMIN', async () => {
    const { app } = testApp();
    const anonymous = await request(app).get('/api/admin/teachers');

    const authService = new FakeAuthService();
    authService.authenticatedUser = { ...admin, role: 'USER' };
    const forbidden = await request(testApp(authService).app)
      .get('/api/admin/teachers')
      .set('Cookie', 'absensi_access=access-token');

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('lists teachers with normalized search and pagination', async () => {
    const { app, teacherService } = testApp();
    const response = await request(app)
      .get('/api/admin/teachers?search= Guru &page=2&pageSize=25')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(200);
    expect(teacherService.listInput).toEqual({
      search: 'Guru',
      page: 2,
      pageSize: 25,
    });
    expect(response.body.data).toEqual([teacher]);
  });

  it('creates a teacher without accepting a client-supplied role', async () => {
    const { app, teacherService } = testApp();
    const invalid = await request(app)
      .post('/api/admin/teachers')
      .set('Cookie', 'absensi_access=access-token')
      .send({
        nip: '19870001',
        fullName: 'Guru Contoh',
        initialPassword: 'Sementara-123',
        role: 'SUPER_ADMIN',
      });
    const response = await request(app)
      .post('/api/admin/teachers')
      .set('Cookie', 'absensi_access=access-token')
      .send({
        nip: '19870001',
        fullName: 'Guru Contoh',
        initialPassword: 'Sementara-123',
      });

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ teacher });
    expect(teacherService.createInput?.nip).toBe('19870001');
  });

  it('updates only the editable NIP and profile name', async () => {
    const { app, teacherService } = testApp();
    const response = await request(app)
      .patch(`/api/admin/teachers/${teacher.id}`)
      .set('Cookie', 'absensi_access=access-token')
      .send({ nip: '19870002', fullName: 'Nama Baru' });

    expect(response.status).toBe(200);
    expect(teacherService.updateInput).toEqual({
      nip: '19870002',
      fullName: 'Nama Baru',
    });
  });

  it.each([
    ['activate', true],
    ['deactivate', false],
  ] as const)('%ss a teacher', async (action, isActive) => {
    const { app, teacherService } = testApp();
    const response = await request(app)
      .post(`/api/admin/teachers/${teacher.id}/${action}`)
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(200);
    expect(response.body.teacher.isActive).toBe(isActive);
    expect(teacherService.action).toBe(action);
  });

  it('generates a temporary password on the server and returns it once', async () => {
    const { app, teacherService } = testApp();
    const response = await request(app)
      .post(`/api/admin/teachers/${teacher.id}/reset-password`)
      .set('Cookie', 'absensi_access=access-token')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      temporaryPassword: 'AG-vA7Qm2pR-2026',
      expiresAt: '2026-08-28T01:00:00.000Z',
      teacher: { temporaryPasswordExpiresAt: '2026-08-28T01:00:00.000Z' },
    });
    expect(teacherService.action).toBe('reset-password');

    const clientPassword = await request(app)
      .post(`/api/admin/teachers/${teacher.id}/reset-password`)
      .set('Cookie', 'absensi_access=access-token')
      .send({ temporaryPassword: 'Password-Baru-123' });
    expect(clientPassword.status).toBe(400);
  });
});
