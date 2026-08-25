import type { AuthUser } from '@absensi/contracts';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  provideRouter,
} from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from './auth.service';
import {
  authGuard,
  passwordChangedGuard,
  roleGuard,
} from './auth.guards';

const teacher: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

describe('auth route guards', () => {
  const currentUser = signal<AuthUser | null>(null);
  const authService = {
    user: currentUser.asReadonly(),
    ensureSession: vi.fn(async () => currentUser()),
  };

  beforeEach(() => {
    currentUser.set(null);
    authService.ensureSession.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
      ],
    });
  });

  function runGuard(
    guard: typeof authGuard,
    url = '/guru',
  ) {
    return TestBed.runInInjectionContext(() =>
      guard(
        {} as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    );
  }

  it('redirects a visitor without a session to login', async () => {
    const result = await runGuard(authGuard);
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result as never)).toBe('/login?returnUrl=%2Fguru');
  });

  it('limits a first-login account to the password change page', async () => {
    currentUser.set({ ...teacher, mustChangePassword: true });
    const result = await runGuard(passwordChangedGuard);
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result as never)).toBe('/change-password');
  });

  it('rejects a USER from a SUPER_ADMIN route', async () => {
    currentUser.set(teacher);
    const result = await runGuard(roleGuard('SUPER_ADMIN'), '/admin');
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result as never)).toBe('/guru');
  });

  it('keeps the first-login restriction when a role guard is used alone', async () => {
    currentUser.set({ ...teacher, mustChangePassword: true });
    const result = await runGuard(roleGuard('USER'), '/guru');
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(result as never)).toBe('/change-password');
  });

  it('allows a SUPER_ADMIN through the matching role guard', async () => {
    currentUser.set({ ...teacher, role: 'SUPER_ADMIN' });

    await expect(
      runGuard(roleGuard('SUPER_ADMIN'), '/admin'),
    ).resolves.toBe(true);
  });
});
