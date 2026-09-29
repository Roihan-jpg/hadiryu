import type {
  AuthUser,
  CalendarException,
  CalendarExceptionsResponse,
  CalendarExceptionInput,
} from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { SettingsService } from './schedule-geofence.js';

const admin: AuthUser = {
  id: '6ebefbc7-8bda-4202-8d9e-95441f0acb03',
  nip: 'admin-001',
  fullName: 'Admin Sekolah',
  role: 'SUPER_ADMIN',
  isActive: true,
  mustChangePassword: false,
};

const exceptionInput: CalendarExceptionInput = {
  workDate: '2026-12-25',
  exceptionType: 'HOLIDAY',
  name: 'Libur Natal',
  scheduleType: null,
};
const exception: CalendarException = {
  id: '40000000-0000-4000-8000-000000000001',
  ...exceptionInput,
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

class FakeSettingsService implements SettingsService {
  async getReportingSettings(): Promise<never> { throw new Error('not used'); }
  async saveReportingSettings(): Promise<never> { throw new Error('not used'); }
  calendar: CalendarExceptionsResponse = { exceptions: [exception] };
  calendarCreate?: { actorId: string; input: CalendarExceptionInput };
  calendarUpdate?: { actorId: string; id: string; input: CalendarExceptionInput };
  calendarDelete?: { actorId: string; id: string };

  async getSchedules() {
    return { effectiveOn: '2026-08-25', weekday: null, saturday: null };
  }
  async saveSchedules() {
    return { effectiveOn: '2026-08-25', weekday: null, saturday: null };
  }
  async getSecuritySchedules(): Promise<never> { throw new Error('not used'); }
  async saveSecuritySchedules(): Promise<never> { throw new Error('not used'); }
  async getGeofence() {
    return { effectiveOn: '2026-08-25', geofence: null };
  }
  async saveGeofence() {
    return { effectiveOn: '2026-08-25', geofence: null };
  }
  async listGeofenceTemplates(): Promise<never> { throw new Error('not used'); }
  async createGeofenceTemplate(): Promise<never> { throw new Error('not used'); }
  async updateGeofenceTemplate(): Promise<never> { throw new Error('not used'); }
  async deleteGeofenceTemplate(): Promise<never> { throw new Error('not used'); }
  async activateGeofenceTemplate(): Promise<never> { throw new Error('not used'); }
  async listCalendarExceptions(): Promise<CalendarExceptionsResponse> {
    return this.calendar;
  }
  async createCalendarException(actorId: string, input: CalendarExceptionInput) {
    this.calendarCreate = { actorId, input };
    return exception;
  }
  async updateCalendarException(
    actorId: string,
    id: string,
    input: CalendarExceptionInput,
  ) {
    this.calendarUpdate = { actorId, id, input };
    return { ...exception, ...input };
  }
  async deleteCalendarException(actorId: string, id: string) {
    this.calendarDelete = { actorId, id };
  }
}

function testApp(authService = new FakeAuthService()) {
  const settingsService = new FakeSettingsService();
  return { app: createApp({ authService, settingsService }), settingsService };
}

describe('calendar HTTP API', () => {
  it('requires SUPER_ADMIN access for calendar settings', async () => {
    const anonymous = await request(testApp().app).get('/api/admin/settings/calendar');
    const userAuth = new FakeAuthService();
    userAuth.authenticatedUser = { ...admin, role: 'USER' };
    const forbidden = await request(testApp(userAuth).app)
      .get('/api/admin/settings/calendar')
      .set('Cookie', 'absensi_session=access-token');

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
  });

  it('lists and mutates one future calendar exception through the API', async () => {
    const { app, settingsService } = testApp();
    const listed = await request(app)
      .get('/api/admin/settings/calendar')
      .set('Cookie', 'absensi_session=access-token');
    const created = await request(app)
      .post('/api/admin/settings/calendar')
      .set('Cookie', 'absensi_session=access-token')
      .send(exceptionInput);
    const updated = await request(app)
      .patch(`/api/admin/settings/calendar/${exception.id}`)
      .set('Cookie', 'absensi_session=access-token')
      .send({ ...exceptionInput, name: 'Libur Nasional' });
    const deleted = await request(app)
      .delete(`/api/admin/settings/calendar/${exception.id}`)
      .set('Cookie', 'absensi_session=access-token');

    expect(listed.status).toBe(200);
    expect(listed.body.exceptions).toHaveLength(1);
    expect(created.status).toBe(201);
    expect(settingsService.calendarCreate).toEqual({ actorId: admin.id, input: exceptionInput });
    expect(updated.status).toBe(200);
    expect(settingsService.calendarUpdate).toMatchObject({
      actorId: admin.id,
      id: exception.id,
      input: { name: 'Libur Nasional' },
    });
    expect(deleted.status).toBe(204);
    expect(settingsService.calendarDelete).toEqual({ actorId: admin.id, id: exception.id });
  });

  it('does not expose the removed payroll endpoints', async () => {
    const { app } = testApp();
    const loaded = await request(app)
      .get('/api/admin/settings/payroll?effectiveOn=2026-08-01')
      .set('Cookie', 'absensi_session=access-token');
    const created = await request(app)
      .post('/api/admin/settings/payroll')
      .set('Cookie', 'absensi_session=access-token')
      .send({});

    expect(loaded.status).toBe(404);
    expect(created.status).toBe(404);
  });
});
