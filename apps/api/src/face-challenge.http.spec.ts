import type { AuthUser } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001', nip: '1987001', fullName: 'Guru',
  role: 'USER', isActive: true, mustChangePassword: false,
};

class FakeAuth implements AuthService {
  user = teacher;
  async authenticate(): Promise<AuthUser> { return this.user; }
  async login(): Promise<SessionResult> { throw new Error('unused'); }
  async refresh(): Promise<SessionResult> { throw new Error('unused'); }
  async changePassword(): Promise<SessionResult> { throw new Error('unused'); }
  async logout(): Promise<void> {}
}

describe('face challenge preview API', () => {
  it('requires a valid Guru session and does not accept Satpam', async () => {
    const auth = new FakeAuth();
    const app = createApp({ authService: auth });
    const anonymous = await request(app).post('/api/attendance/face/challenge').send({ action: 'CHECK_IN' });
    auth.user = { ...teacher, role: 'SECURITY_GUARD' };
    const satpam = await request(app).post('/api/attendance/face/challenge').set('Cookie', 'absensi_session=token').send({ action: 'CHECK_IN' });
    expect(anonymous.status).toBe(401);
    expect(satpam.status).toBe(403);
  });

  it('issues a random short-lived challenge but never records attendance', async () => {
    const app = createApp({ authService: new FakeAuth() });
    const first = await request(app).post('/api/attendance/face/challenge').set('Cookie', 'absensi_session=token').send({ action: 'CHECK_IN' });
    const second = await request(app).post('/api/attendance/face/challenge').set('Cookie', 'absensi_session=token').send({ action: 'CHECK_IN' });
    expect(first.status).toBe(200);
    expect(first.body.steps).toContain('BLINK');
    expect(first.body.steps.some((step: string) => step === 'TURN_LEFT' || step === 'TURN_RIGHT')).toBe(true);
    expect(second.body.challengeId).not.toBe(first.body.challengeId);
    expect(new Date(first.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(90_000);
  });

  it('rejects manipulated browser verdict and frame payload', async () => {
    const app = createApp({ authService: new FakeAuth() });
    const result = await request(app).post('/api/attendance/face/challenge').set('Cookie', 'absensi_session=token').send({ action: 'CHECK_IN', challengePassed: true, faceMatch: true, frames: ['fake'] });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does not let a forged face verdict enter the existing attendance mutation', async () => {
    const app = createApp({ authService: new FakeAuth() });
    const result = await request(app).post('/api/attendance/check-in').set('Cookie', 'absensi_session=token').send({
      latitude: -6.2, longitude: 106.8, accuracyMeters: 10, faceVerified: true,
    });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });
});
