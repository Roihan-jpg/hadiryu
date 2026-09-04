import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
} from '@absensi/contracts';
import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import {
  AppError,
  type AuthService,
  type SessionResult,
  createSessionGuard,
  requirePasswordChanged,
  requireRole,
} from './auth.js';

const user: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

class FakeAuthService implements AuthService {
  loginInput?: LoginRequest;
  refreshInput?: string;
  changePasswordInput?: ChangePasswordRequest;
  authenticatedUser = user;

  async login(input: LoginRequest): Promise<SessionResult> {
    this.loginInput = input;
    return this.sessionFor(user);
  }

  async refresh(refreshToken: string): Promise<SessionResult> {
    this.refreshInput = refreshToken;
    return this.sessionFor(this.authenticatedUser);
  }

  async authenticate(): Promise<AuthUser> {
    return this.authenticatedUser;
  }

  async changePassword(
    _accessToken: string,
    _refreshToken: string,
    input: ChangePasswordRequest,
  ): Promise<SessionResult> {
    this.changePasswordInput = input;
    return this.sessionFor({
      ...this.authenticatedUser,
      mustChangePassword: false,
    });
  }

  async logout(): Promise<void> {}

  private sessionFor(sessionUser: AuthUser): SessionResult {
    return {
      user: sessionUser,
      accessToken: 'access-token',
      refreshToken: 'refresh-token-baru',
      expiresIn: 3600,
    };
  }
}

describe('auth HTTP API', () => {
  it('logs in with NIP and stores both tokens only in HttpOnly cookies', async () => {
    const authService = new FakeAuthService();

    const response = await request(createApp({ authService }))
      .post('/api/auth/login')
      .send({ nip: ' 001234567890 ', password: 'rahasia-sementara' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user });
    expect(authService.loginInput?.nip).toBe('001234567890');
    const setCookieHeader = response.headers['set-cookie'];
    const setCookies = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : [setCookieHeader];
    expect(setCookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^absensi_access=access-token;.*HttpOnly.*SameSite=Strict/i),
        expect.stringMatching(
          /^absensi_refresh=refresh-token-baru;.*HttpOnly.*SameSite=Strict/i,
        ),
      ]),
    );
    expect(
      setCookies.find(
        (cookie): cookie is string =>
          cookie?.startsWith('absensi_refresh=') ?? false,
      ),
    ).toContain('Max-Age=');
    expect(JSON.stringify(response.body)).not.toContain('token');
  });

  it('returns a structured validation error without calling Auth', async () => {
    const authService = new FakeAuthService();

    const response = await request(createApp({ authService }))
      .post('/api/auth/login')
      .send({ nip: 'NIP DENGAN SPASI', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(authService.loginInput).toBeUndefined();
  });

  it('returns a structured validation error for malformed JSON', async () => {
    const response = await request(createApp({
      authService: new FakeAuthService(),
    }))
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"nip":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('loads me from an authenticated access cookie', async () => {
    const response = await request(createApp({
      authService: new FakeAuthService(),
    }))
      .get('/api/auth/me')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user });
  });

  it('rejects an inactive account on every authenticated request', async () => {
    const authService = new FakeAuthService();
    authService.authenticate = async () => {
      throw new AppError(403, 'ACCOUNT_INACTIVE', 'Akun dinonaktifkan');
    };

    const response = await request(createApp({ authService }))
      .get('/api/auth/me')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rotates a refresh token and overwrites the cookie pair', async () => {
    const authService = new FakeAuthService();

    const response = await request(createApp({ authService }))
      .post('/api/auth/refresh')
      .set('Cookie', 'absensi_refresh=refresh-token-lama');

    expect(response.status).toBe(200);
    expect(authService.refreshInput).toBe('refresh-token-lama');
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it('allows a first-login user to change password then clears the flag', async () => {
    const authService = new FakeAuthService();

    const response = await request(createApp({ authService }))
      .post('/api/auth/change-password')
      .set(
        'Cookie',
        'absensi_access=access-token; absensi_refresh=refresh-token',
      )
      .send({ currentPassword: 'password-lama', newPassword: 'password-baru' });

    expect(response.status).toBe(200);
    expect(response.body.user.mustChangePassword).toBe(false);
    expect(authService.changePasswordInput?.newPassword).toBe('password-baru');
  });

  it('clears both cookies on logout even when the session is already invalid', async () => {
    const authService = new FakeAuthService();
    authService.logout = async () => {
      throw new AppError(401, 'AUTH_REQUIRED', 'Sesi tidak valid');
    };

    const response = await request(createApp({ authService }))
      .post('/api/auth/logout')
      .set('Cookie', 'absensi_access=expired; absensi_refresh=invalid');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^absensi_access=;/),
        expect.stringMatching(/^absensi_refresh=;/),
      ]),
    );
  });
});

describe('auth authorization guards', () => {
  function guardApp(
    authService: FakeAuthService,
    guard: ReturnType<typeof requireRole> | typeof requirePasswordChanged,
  ) {
    const app = express();
    app.use(cookieParser());
    app.get(
      '/protected',
      createSessionGuard(authService),
      guard,
      (_request, response) => response.status(204).end(),
    );
    return app;
  }

  it('limits a first-login user to auth completion endpoints', async () => {
    const authService = new FakeAuthService();

    const response = await request(
      guardApp(authService, requirePasswordChanged),
    )
      .get('/protected')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('keeps the password-change restriction when a role guard is used alone', async () => {
    const authService = new FakeAuthService();

    const response = await request(
      guardApp(authService, requireRole('USER')),
    )
      .get('/protected')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('does not allow USER through a SUPER_ADMIN role guard', async () => {
    const authService = new FakeAuthService();
    authService.authenticatedUser = {
      ...user,
      mustChangePassword: false,
    };

    const response = await request(
      guardApp(authService, requireRole('SUPER_ADMIN')),
    )
      .get('/protected')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ROLE_FORBIDDEN');
  });

  it('allows an active SUPER_ADMIN with a completed password change', async () => {
    const authService = new FakeAuthService();
    authService.authenticatedUser = {
      ...user,
      role: 'SUPER_ADMIN',
      mustChangePassword: false,
    };

    const response = await request(
      guardApp(authService, requireRole('SUPER_ADMIN')),
    )
      .get('/protected')
      .set('Cookie', 'absensi_access=access-token');

    expect(response.status).toBe(204);
  });
});
