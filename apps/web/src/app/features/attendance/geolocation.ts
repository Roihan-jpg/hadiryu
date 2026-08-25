import { InjectionToken } from '@angular/core';

export const GEOLOCATION = new InjectionToken<Geolocation | null>(
  'Browser geolocation',
  {
    providedIn: 'root',
    factory: () =>
      typeof navigator === 'undefined' ? null : (navigator.geolocation ?? null),
  },
);

