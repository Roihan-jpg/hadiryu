import type {
  AuthUser,
  GeofenceSettingsResponse,
  SaveGeofenceSettingsRequest,
  SaveScheduleSettingsRequest,
  ScheduleSettingsResponse,
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

const effectiveOn = '2026-09-01';

const scheduleInput: SaveScheduleSettingsRequest = {
  weekday: {
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '12:00',
    workEnd: '15:35',
    checkoutClose: '17:00',
    targetMinutes: 515,
  },
  saturday: {
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '09:30',
    workEnd: '10:35',
    checkoutClose: '12:00',
    targetMinutes: 215,
  },
};

const schedules: ScheduleSettingsResponse = {
  effectiveOn,
  weekday: {
    id: '10000000-0000-4000-8000-000000000021',
    scheduleType: 'WEEKDAY',
    ...scheduleInput.weekday,
    effectiveFrom: effectiveOn,
    effectiveTo: null,
  },
  saturday: {
    id: '10000000-0000-4000-8000-000000000022',
    scheduleType: 'SATURDAY',
    ...scheduleInput.saturday,
    effectiveFrom: effectiveOn,
    effectiveTo: null,
  },
};

const geofenceInput: SaveGeofenceSettingsRequest = {
  shape: 'POLYGON',
  vertices: [
    { latitude: -6.2003, longitude: 106.8163 },
    { latitude: -6.2003, longitude: 106.8170 },
    { latitude: -6.1997, longitude: 106.8170 },
    { latitude: -6.1997, longitude: 106.8163 },
  ],
  maxAccuracyMeters: 15,
};

const geofence: GeofenceSettingsResponse = {
  effectiveOn,
  geofence: {
    id: '20000000-0000-4000-8000-000000000021',
    ...geofenceInput,
    effectiveFrom: effectiveOn,
    effectiveTo: null,
  },
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
  scheduleDate?: string;
  scheduleSave?: { actorId: string; input: SaveScheduleSettingsRequest };
  geofenceDate?: string;
  geofenceSave?: { actorId: string; input: SaveGeofenceSettingsRequest };

  async getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse> {
    this.scheduleDate = effectiveOn;
    return { ...schedules, effectiveOn };
  }

  async saveSchedules(
    actorId: string,
    input: SaveScheduleSettingsRequest,
  ): Promise<ScheduleSettingsResponse> {
    this.scheduleSave = { actorId, input };
    return schedules;
  }

  async getSecuritySchedules(): Promise<never> { throw new Error('not used'); }
  async saveSecuritySchedules(): Promise<never> { throw new Error('not used'); }

  async getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse> {
    this.geofenceDate = effectiveOn;
    return { ...geofence, effectiveOn };
  }

  async saveGeofence(
    actorId: string,
    input: SaveGeofenceSettingsRequest,
  ): Promise<GeofenceSettingsResponse> {
    this.geofenceSave = { actorId, input };
    return geofence;
  }

  async listCalendarExceptions(): Promise<never> {
    throw new Error('not used');
  }

  async createCalendarException(): Promise<never> {
    throw new Error('not used');
  }

  async updateCalendarException(): Promise<never> {
    throw new Error('not used');
  }

  async deleteCalendarException(): Promise<never> {
    throw new Error('not used');
  }

}

function testApp(authService = new FakeAuthService()) {
  const settingsService = new FakeSettingsService();
  return {
    app: createApp({ authService, settingsService }),
    settingsService,
  };
}

describe('schedule-geofence HTTP API', () => {
  it('requires an authenticated SUPER_ADMIN for operational settings', async () => {
    const anonymous = await request(testApp().app).get(
      '/api/admin/settings/schedules?effectiveOn=2026-08-25',
    );
    const userAuth = new FakeAuthService();
    userAuth.authenticatedUser = { ...admin, role: 'USER' };
    const forbidden = await request(testApp(userAuth).app)
      .get('/api/admin/settings/geofence?effectiveOn=2026-08-25')
      .set('Cookie', 'absensi_session=access-token');

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('resolves schedule rules for an explicitly requested historical date', async () => {
    const { app, settingsService } = testApp();
    const response = await request(app)
      .get('/api/admin/settings/schedules?effectiveOn=2026-08-31')
      .set('Cookie', 'absensi_session=access-token');

    expect(response.status).toBe(200);
    expect(settingsService.scheduleDate).toBe('2026-08-31');
    expect(response.body.weekday.scheduleType).toBe('WEEKDAY');
    expect(response.body.saturday.scheduleType).toBe('SATURDAY');
  });

  it('saves both schedule types for the server date without accepting a client date', async () => {
    const { app, settingsService } = testApp();
    const invalid = await request(app)
      .post('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_session=access-token')
      .send({
        ...scheduleInput,
        weekday: { ...scheduleInput.weekday, workStart: '05:00' },
      });
    const response = await request(app)
      .post('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_session=access-token')
      .send(scheduleInput);
    const clientDated = await request(app)
      .post('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_session=access-token')
      .send({ ...scheduleInput, effectiveFrom: effectiveOn });

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(201);
    expect(clientDated.status).toBe(400);
    expect(settingsService.scheduleSave).toEqual({
      actorId: admin.id,
      input: scheduleInput,
    });
  });

  it('resolves history and saves the global geofence for the server date', async () => {
    const { app, settingsService } = testApp();
    const loaded = await request(app)
      .get('/api/admin/settings/geofence?effectiveOn=2026-08-31')
      .set('Cookie', 'absensi_session=access-token');
    const created = await request(app)
      .post('/api/admin/settings/geofence')
      .set('Cookie', 'absensi_session=access-token')
      .send(geofenceInput);
    const clientDated = await request(app)
      .post('/api/admin/settings/geofence')
      .set('Cookie', 'absensi_session=access-token')
      .send({ ...geofenceInput, effectiveFrom: effectiveOn });

    expect(loaded.status).toBe(200);
    expect(settingsService.geofenceDate).toBe('2026-08-31');
    expect(created.status).toBe(201);
    expect(clientDated.status).toBe(400);
    expect(settingsService.geofenceSave).toEqual({
      actorId: admin.id,
      input: geofenceInput,
    });
  });

  it('rejects missing resolution dates and extra geofence locations', async () => {
    const { app } = testApp();
    const missingDate = await request(app)
      .get('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_session=access-token');
    const multipleLocations = await request(app)
      .post('/api/admin/settings/geofence')
      .set('Cookie', 'absensi_session=access-token')
      .send({ ...geofenceInput, locations: [geofenceInput] });

    expect(missingDate.status).toBe(400);
    expect(multipleLocations.status).toBe(400);
  });
});
