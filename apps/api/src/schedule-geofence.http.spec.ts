import type {
  AuthUser,
  CreateGeofenceVersionRequest,
  CreateScheduleVersionRequest,
  GeofenceSettingsResponse,
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

const scheduleInput: CreateScheduleVersionRequest = {
  effectiveFrom: '2026-09-01',
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
  effectiveOn: scheduleInput.effectiveFrom,
  weekday: {
    id: '10000000-0000-4000-8000-000000000021',
    scheduleType: 'WEEKDAY',
    ...scheduleInput.weekday,
    effectiveFrom: scheduleInput.effectiveFrom,
    effectiveTo: null,
  },
  saturday: {
    id: '10000000-0000-4000-8000-000000000022',
    scheduleType: 'SATURDAY',
    ...scheduleInput.saturday,
    effectiveFrom: scheduleInput.effectiveFrom,
    effectiveTo: null,
  },
};

const geofenceInput: CreateGeofenceVersionRequest = {
  effectiveFrom: '2026-09-01',
  latitude: -6.2,
  longitude: 106.816666,
  radiusMeters: 100,
  maxAccuracyMeters: 50,
};

const geofence: GeofenceSettingsResponse = {
  effectiveOn: geofenceInput.effectiveFrom,
  geofence: {
    id: '20000000-0000-4000-8000-000000000021',
    ...geofenceInput,
    effectiveFrom: geofenceInput.effectiveFrom,
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
  scheduleCreate?: { actorId: string; input: CreateScheduleVersionRequest };
  geofenceDate?: string;
  geofenceCreate?: { actorId: string; input: CreateGeofenceVersionRequest };

  async getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse> {
    this.scheduleDate = effectiveOn;
    return { ...schedules, effectiveOn };
  }

  async createScheduleVersion(
    actorId: string,
    input: CreateScheduleVersionRequest,
  ): Promise<ScheduleSettingsResponse> {
    this.scheduleCreate = { actorId, input };
    return schedules;
  }

  async getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse> {
    this.geofenceDate = effectiveOn;
    return { ...geofence, effectiveOn };
  }

  async createGeofenceVersion(
    actorId: string,
    input: CreateGeofenceVersionRequest,
  ): Promise<GeofenceSettingsResponse> {
    this.geofenceCreate = { actorId, input };
    return geofence;
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
      .set('Cookie', 'absensi_access=access-token');

    expect(anonymous.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('resolves schedule rules for an explicitly requested historical date', async () => {
    const { app, settingsService } = testApp();
    const response = await request(app)
      .get('/api/admin/settings/schedules?effectiveOn=2026-08-31')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(200);
    expect(settingsService.scheduleDate).toBe('2026-08-31');
    expect(response.body.weekday.scheduleType).toBe('WEEKDAY');
    expect(response.body.saturday.scheduleType).toBe('SATURDAY');
  });

  it('creates both schedule types as one effective version', async () => {
    const { app, settingsService } = testApp();
    const invalid = await request(app)
      .post('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_access=access-token')
      .send({
        ...scheduleInput,
        weekday: { ...scheduleInput.weekday, workStart: '05:00' },
      });
    const response = await request(app)
      .post('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_access=access-token')
      .send(scheduleInput);

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(201);
    expect(settingsService.scheduleCreate).toEqual({
      actorId: admin.id,
      input: scheduleInput,
    });
  });

  it('resolves and creates the one global geofence version', async () => {
    const { app, settingsService } = testApp();
    const loaded = await request(app)
      .get('/api/admin/settings/geofence?effectiveOn=2026-08-31')
      .set('Cookie', 'absensi_access=access-token');
    const created = await request(app)
      .post('/api/admin/settings/geofence')
      .set('Cookie', 'absensi_access=access-token')
      .send(geofenceInput);

    expect(loaded.status).toBe(200);
    expect(settingsService.geofenceDate).toBe('2026-08-31');
    expect(created.status).toBe(201);
    expect(settingsService.geofenceCreate).toEqual({
      actorId: admin.id,
      input: geofenceInput,
    });
  });

  it('rejects missing resolution dates and extra geofence locations', async () => {
    const { app } = testApp();
    const missingDate = await request(app)
      .get('/api/admin/settings/schedules')
      .set('Cookie', 'absensi_access=access-token');
    const multipleLocations = await request(app)
      .post('/api/admin/settings/geofence')
      .set('Cookie', 'absensi_access=access-token')
      .send({ ...geofenceInput, locations: [geofenceInput] });

    expect(missingDate.status).toBe(400);
    expect(multipleLocations.status).toBe(400);
  });
});
