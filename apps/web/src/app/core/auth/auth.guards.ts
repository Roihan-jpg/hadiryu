import type { UserRole } from '@absensi/contracts';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

async function resolveUser() {
  const auth = inject(AuthService);
  return auth.user() ?? auth.ensureSession();
}

function homeUrl(role: UserRole): string {
  return role === 'SUPER_ADMIN' ? '/admin' : role === 'SECURITY_GUARD' ? '/satpam' : '/guru';
}

export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const user = await resolveUser();
  return (
    !!user ||
    router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    })
  );
};

export const passwordChangedGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const user = await resolveUser();
  if (!user) return router.createUrlTree(['/login']);
  return user.mustChangePassword
    ? router.createUrlTree(['/change-password'])
    : true;
};

export function roleGuard(...roles: UserRole[]): CanActivateFn {
  return async () => {
    const router = inject(Router);
    const user = await resolveUser();
    if (!user) return router.createUrlTree(['/login']);
    if (user.mustChangePassword) {
      return router.createUrlTree(['/change-password']);
    }
    return roles.includes(user.role)
      ? true
      : router.createUrlTree([homeUrl(user.role)]);
  };
}

export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const user = await resolveUser();
  if (!user) return true;
  return router.createUrlTree([
    user.mustChangePassword ? '/change-password' : homeUrl(user.role),
  ]);
};
