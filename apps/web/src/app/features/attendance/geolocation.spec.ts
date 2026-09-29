import { describe, expect, it, vi } from 'vitest';

import {
  acquirePreciseLocation,
  PreciseLocationError,
} from './geolocation';

class FakeGeolocation {
  success?: PositionCallback;
  failure?: PositionErrorCallback;
  readonly clearWatch = vi.fn();
  readonly watchPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
    this.success = success;
    this.failure = failure ?? undefined;
    return 17;
  });
}

describe('acquirePreciseLocation', () => {
  it('keeps watching after a poor fix and returns the best acceptable sample', async () => {
    const geolocation = new FakeGeolocation();
    const progress = vi.fn();
    const result = acquirePreciseLocation(
      geolocation as unknown as Geolocation,
      15,
      progress,
    );

    geolocation.success?.({
      coords: { latitude: -8.1329, longitude: 113.2220, accuracy: 64 },
    } as GeolocationPosition);
    expect(progress).toHaveBeenLastCalledWith({
      location: {
        latitude: -8.1329,
        longitude: 113.222,
        accuracyMeters: 64,
      },
      bestAccuracyMeters: 64,
      maxAccuracyMeters: 15,
    });
    expect(geolocation.clearWatch).not.toHaveBeenCalled();

    geolocation.success?.({
      coords: { latitude: -8.1328, longitude: 113.2219, accuracy: 12 },
    } as GeolocationPosition);
    await expect(result).resolves.toEqual({
      latitude: -8.1328,
      longitude: 113.2219,
      accuracyMeters: 12,
    });
    expect(geolocation.clearWatch).toHaveBeenCalledWith(17);
  });

  it('reports the best observed accuracy when the search times out', async () => {
    vi.useFakeTimers();
    const geolocation = new FakeGeolocation();
    const result = acquirePreciseLocation(
      geolocation as unknown as Geolocation,
      15,
    );
    const rejection = expect(result).rejects.toMatchObject({
      state: 'INACCURATE',
      bestAccuracyMeters: 42,
    } satisfies Partial<PreciseLocationError>);
    geolocation.success?.({
      coords: { latitude: -8.1329, longitude: 113.2220, accuracy: 42 },
    } as GeolocationPosition);

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    vi.useRealTimers();
  });

  it('continues watching after a transient provider error', async () => {
    const geolocation = new FakeGeolocation();
    const result = acquirePreciseLocation(
      geolocation as unknown as Geolocation,
      15,
    );

    geolocation.failure?.({ code: 2 } as GeolocationPositionError);
    geolocation.success?.({
      coords: { latitude: -8.1328, longitude: 113.2219, accuracy: 11 },
    } as GeolocationPosition);

    await expect(result).resolves.toMatchObject({ accuracyMeters: 11 });
  });
});
