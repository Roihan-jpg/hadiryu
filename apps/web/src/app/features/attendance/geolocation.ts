import { InjectionToken } from '@angular/core';
import type { LocationInput } from '@absensi/contracts';

export type PreciseLocationState =
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INACCURATE';

export class PreciseLocationError extends Error {
  constructor(
    readonly state: PreciseLocationState,
    readonly bestAccuracyMeters?: number,
  ) {
    super(state);
  }
}

export interface LocationAccuracyProgress {
  bestAccuracyMeters: number;
  maxAccuracyMeters: number;
}

const LOCATION_SEARCH_TIMEOUT_MS = 30_000;

function locationInput(position: GeolocationPosition): LocationInput {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
  };
}

function providerError(error: GeolocationPositionError): PreciseLocationError {
  return new PreciseLocationError(
    error.code === 1 ? 'DENIED' : error.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE',
  );
}

export function acquirePreciseLocation(
  geolocation: Geolocation,
  maxAccuracyMeters: number,
  onProgress?: (progress: LocationAccuracyProgress) => void,
  enableHighAccuracy = true,
): Promise<LocationInput> {
  if (typeof geolocation.watchPosition !== 'function') {
    return new Promise((resolve, reject) => {
      geolocation.getCurrentPosition(
        (position) => {
          const location = locationInput(position);
          if (location.accuracyMeters <= maxAccuracyMeters) resolve(location);
          else reject(new PreciseLocationError('INACCURATE', location.accuracyMeters));
        },
        (error) => reject(providerError(error)),
        { enableHighAccuracy, maximumAge: 0, timeout: LOCATION_SEARCH_TIMEOUT_MS },
      );
    });
  }

  return new Promise((resolve, reject) => {
    let best: LocationInput | null = null;
    let lastProviderError: PreciseLocationError | null = null;
    let settled = false;
    let watchId = 0;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      geolocation.clearWatch(watchId);
      callback();
    };
    const timeoutId = setTimeout(() => {
      finish(() => reject(best
        ? new PreciseLocationError('INACCURATE', best.accuracyMeters)
        : (lastProviderError ?? new PreciseLocationError('TIMEOUT'))));
    }, LOCATION_SEARCH_TIMEOUT_MS);

    watchId = geolocation.watchPosition(
      (position) => {
        const candidate = locationInput(position);
        if (!best || candidate.accuracyMeters < best.accuracyMeters) {
          best = candidate;
          onProgress?.({
            bestAccuracyMeters: candidate.accuracyMeters,
            maxAccuracyMeters,
          });
        }
        if (candidate.accuracyMeters <= maxAccuracyMeters) {
          finish(() => resolve(candidate));
        }
      },
      (error) => {
        const currentError = providerError(error);
        if (currentError.state === 'DENIED') {
          finish(() => reject(currentError));
        } else {
          lastProviderError = currentError;
        }
      },
      { enableHighAccuracy, maximumAge: 0, timeout: LOCATION_SEARCH_TIMEOUT_MS },
    );
  });
}

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
