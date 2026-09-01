import { InjectionToken } from '@angular/core';

export const GEOLOCATION = new InjectionToken<Geolocation | null>(
  'Browser geolocation',
  {
    providedIn: 'root',
    factory: () =>
      typeof navigator === 'undefined' ? null : (navigator.geolocation ?? null),
  },
);

export const GEOLOCATION_PERMISSIONS = new InjectionToken<Permissions | null>(
  'Browser permissions',
  {
    providedIn: 'root',
    factory: () =>
      typeof navigator === 'undefined' ? null : (navigator.permissions ?? null),
  },
);
