import type { AuthResponse, AuthUser } from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';

const user: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: true,
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('logs in through the API with cookies and keeps only the public profile', async () => {
    const resultPromise = service.login({
      nip: '001234567890',
      password: 'password-awal',
    });
    const request = http.expectOne('/api/auth/login');

    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user } satisfies AuthResponse);

    await expect(resultPromise).resolves.toEqual(user);
    expect(service.user()).toEqual(user);
    expect(localStorage.length).toBe(0);
  });

  it('rejects an API response that does not satisfy the shared auth contract', async () => {
    const resultPromise = service.login({
      nip: '001234567890',
      password: 'password-awal',
    });
    http.expectOne('/api/auth/login').flush({
      user: { id: user.id, nip: user.nip, role: user.role },
    });

    await expect(resultPromise).rejects.toBeDefined();
    expect(service.user()).toBeNull();
  });

  it('refreshes an expired access session using the HttpOnly refresh cookie', async () => {
    const resultPromise = service.refresh();
    const request = http.expectOne('/api/auth/refresh');

    expect(request.request.body).toEqual({});
    expect(request.request.withCredentials).toBe(true);
    request.flush({ user: { ...user, mustChangePassword: false } });

    await resultPromise;
    expect(service.user()?.mustChangePassword).toBe(false);
  });

  it('falls back to refresh when me reports an expired access cookie', async () => {
    const resultPromise = service.ensureSession();
    http.expectOne('/api/auth/me').flush(
      { error: { code: 'AUTH_REQUIRED', message: 'Sesi habis' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    await Promise.resolve();
    http.expectOne('/api/auth/refresh').flush({ user });

    await expect(resultPromise).resolves.toEqual(user);
  });

  it('clears local profile state after logout', async () => {
    const loginPromise = service.login({ nip: user.nip, password: 'password-awal' });
    http.expectOne('/api/auth/login').flush({ user });
    await loginPromise;

    const logoutPromise = service.logout();
    http.expectOne('/api/auth/logout').flush({ success: true });
    await logoutPromise;

    expect(service.user()).toBeNull();
  });
});
