import type {
  AuthUser,
  CheckInRecord,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import {
  AttendanceService,
} from '../attendance/attendance.service';
import {
  GEOLOCATION,
  GEOLOCATION_PERMISSIONS,
} from '../attendance/geolocation';
import { HomePage } from './home-page';
import { SecurityDashboardService } from './security-dashboard.service';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Tujuh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

const ready: TodayAttendanceResponse = {
  serverNow: '2026-08-25T00:00:00.000Z',
  workDate: '2026-08-25',
  state: 'READY_TO_CHECK_IN',
  schedule: {
    scheduleType: 'WEEKDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '12:00',
    workEnd: '15:35',
    checkoutClose: '17:00',
    targetMinutes: 515,
  },
  attendance: null,
  locationRequirement: { maxAccuracyMeters: 15 },
};

const checkedIn: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:00.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 5,
  status: 'CHECKED_IN',
};

class FakeGeolocation {
  readonly successes: PositionCallback[] = [];
  readonly failures: PositionErrorCallback[] = [];
  readonly getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      options?: PositionOptions,
    ) => {
      void options;
      this.successes.push(success);
      if (failure) this.failures.push(failure);
    },
  );
}

describe('HomePage check-in', () => {
  let fixture: ComponentFixture<HomePage>;
  let geolocation: FakeGeolocation;
  let fetchToday: ReturnType<typeof vi.fn>;
  let checkIn: ReturnType<typeof vi.fn>;
  let queryPermission: ReturnType<typeof vi.fn>;

  async function setup(today = ready): Promise<void> {
    geolocation = new FakeGeolocation();
    fetchToday = vi.fn(async () => today);
    checkIn = vi.fn(async () => checkedIn);
    queryPermission = vi.fn(async () => ({ state: 'prompt' as PermissionState }));
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(teacher).asReadonly(),
            logout: vi.fn(async () => undefined),
          },
        },
        { provide: AttendanceService, useValue: { fetchToday, checkIn } },
        { provide: SecurityDashboardService, useValue: { getDashboard: vi.fn() } },
        { provide: GEOLOCATION, useValue: geolocation },
        {
          provide: GEOLOCATION_PERMISSIONS,
          useValue: { query: queryPermission },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loadingToday()).toBe(false));
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads today without requesting location when the page opens', async () => {
    await setup();

    expect(fetchToday).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Belum check-in');
    expect(fixture.nativeElement.textContent).toContain('Dibuka05:30');
    expect(fixture.nativeElement.textContent).toContain('Ditutup08:00');
    expect(fixture.nativeElement.textContent).toContain('Check-in sekarang');
    expect(fixture.nativeElement.textContent).toContain('Tampilkan lokasi saya');
    expect(fixture.nativeElement.querySelector('app-teacher-location-map')).toBeNull();
  });

  it('previews and refreshes the current location without submitting attendance', async () => {
    await setup();

    const first = fixture.componentInstance.showLocationPreview();
    const repeated = fixture.componentInstance.showLocationPreview();
    fixture.detectChanges();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('button[data-action="location-preview"]')
        .disabled,
    ).toBe(true);

    geolocation.successes[0]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10.4 },
    } as GeolocationPosition);
    await Promise.all([first, repeated]);
    fixture.detectChanges();

    expect(checkIn).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('-6.200000');
    expect(fixture.nativeElement.textContent).toContain('106.816666');
    expect(fixture.nativeElement.textContent).toContain('10 meter');
    expect(fixture.nativeElement.textContent).toContain('Perbarui lokasi');

    const refresh = fixture.componentInstance.showLocationPreview();
    geolocation.successes[1]?.({
      coords: { latitude: -6.21, longitude: 106.82, accuracy: 14.6 },
    } as GeolocationPosition);
    await refresh;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('-6.210000');
    expect(fixture.nativeElement.textContent).toContain('106.820000');
    expect(fixture.nativeElement.textContent).toContain('15 meter');
  });

  it('shows a preview from the first location fix even when it is not accurate enough for attendance', async () => {
    await setup({
      ...ready,
      locationRequirement: { maxAccuracyMeters: 10 },
    });

    const preview = fixture.componentInstance.showLocationPreview();
    geolocation.successes[0]?.({
      coords: { latitude: -8.132722, longitude: 113.221889, accuracy: 83 },
    } as GeolocationPosition);
    await preview;
    fixture.detectChanges();

    expect(checkIn).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('-8.132722');
    expect(fixture.nativeElement.textContent).toContain('113.221889');
    expect(fixture.nativeElement.textContent).toContain('83 meter');
    expect(fixture.nativeElement.querySelector('app-teacher-location-map')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('syarat maksimal 10 meter');
  });

  it('blocks attendance while a location preview request is active', async () => {
    await setup();

    const preview = fixture.componentInstance.showLocationPreview();
    await fixture.componentInstance.checkIn();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(checkIn).not.toHaveBeenCalled();

    geolocation.successes[0]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await preview;
  });

  it('shows a preview-specific timeout without leaving a stale map', async () => {
    await setup();

    const promise = fixture.componentInstance.showLocationPreview();
    geolocation.failures[0]?.({ code: 3 } as GeolocationPositionError);
    await promise;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Lokasi belum ditemukan. Berpindah ke area terbuka lalu coba lagi.',
    );
    expect(fixture.nativeElement.querySelector('app-teacher-location-map')).toBeNull();
    expect(checkIn).not.toHaveBeenCalled();
  });

  it('replaces a failed preview with the fresh location used for check-in', async () => {
    await setup();

    const preview = fixture.componentInstance.showLocationPreview();
    geolocation.failures[0]?.({ code: 3 } as GeolocationPositionError);
    await preview;

    const attendance = fixture.componentInstance.checkIn();
    geolocation.successes[1]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await attendance;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain(
      'Lokasi belum ditemukan. Berpindah ke area terbuka lalu coba lagi.',
    );
    expect(fixture.nativeElement.querySelector('app-teacher-location-map')).not.toBeNull();
  });

  it('requests precise current location from the button and prevents double submit', async () => {
    await setup();
    fetchToday.mockResolvedValue({ ...ready, state: 'CHECKED_IN', attendance: checkedIn });

    const first = fixture.componentInstance.checkIn();
    const repeated = fixture.componentInstance.checkIn();
    fixture.detectChanges();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    expect(fixture.componentInstance.permissionState()).toBe('REQUESTING');
    expect(
      fixture.nativeElement.querySelector('button[data-action="check-in"]').disabled,
    ).toBe(true);

    geolocation.successes[0]?.({
      coords: {
        latitude: -6.2,
        longitude: 106.816666,
        accuracy: 10,
      },
    } as GeolocationPosition);
    await Promise.all([first, repeated]);
    await vi.waitFor(() => expect(fixture.componentInstance.today()?.state).toBe('CHECKED_IN'));
    fixture.detectChanges();

    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
    expect(fixture.componentInstance.permissionState()).toBe('GRANTED');
    expect(fixture.componentInstance.today()?.locationRequirement).toEqual({
      maxAccuracyMeters: 15,
    });
    expect(fixture.nativeElement.textContent).toContain('Check-in berhasil');
    expect(fixture.nativeElement.textContent).toContain('Sudah check-in');
  });

  it('shows actionable permission guidance without calling the API', async () => {
    await setup();
    const promise = fixture.componentInstance.checkIn();
    geolocation.failures[0]?.({ code: 1 } as GeolocationPositionError);
    await promise;
    fixture.detectChanges();

    expect(checkIn).not.toHaveBeenCalled();
    expect(fixture.componentInstance.permissionState()).toBe('DENIED');
    expect(fixture.nativeElement.textContent).toContain(
      'Aktifkan izin lokasi untuk situs ini',
    );
  });

  it('retries with standard accuracy when Brave denies high accuracy despite granted permission', async () => {
    await setup();
    queryPermission.mockResolvedValueOnce({ state: 'granted' as PermissionState });

    const promise = fixture.componentInstance.checkIn();
    geolocation.failures[0]?.({ code: 1 } as GeolocationPositionError);
    await vi.waitFor(() => {
      expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    });
    expect(geolocation.getCurrentPosition.mock.calls[1]?.[2]).toEqual({
      enableHighAccuracy: false,
      maximumAge: 0,
      timeout: 30_000,
    });

    geolocation.successes[1]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 12 },
    } as GeolocationPosition);
    await promise;

    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 12,
    });
  });

  it('explains a browser or device denial when site permission is already granted', async () => {
    await setup();
    queryPermission.mockResolvedValueOnce({ state: 'granted' as PermissionState });

    const promise = fixture.componentInstance.checkIn();
    geolocation.failures[0]?.({ code: 1 } as GeolocationPositionError);
    await vi.waitFor(() => {
      expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    });
    geolocation.failures[1]?.({ code: 1 } as GeolocationPositionError);
    await promise;
    fixture.detectChanges();

    expect(fixture.componentInstance.permissionState()).toBe('SYSTEM_DENIED');
    expect(fixture.nativeElement.textContent).toContain(
      'Izin situs sudah aktif, tetapi browser belum dapat membaca lokasi perangkat',
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Aktifkan izin lokasi untuk situs ini',
    );
  });

  it('renders structured domain errors returned by the server', async () => {
    await setup();
    checkIn.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 422,
        error: {
          error: {
            code: 'OUTSIDE_GEOFENCE',
            message: 'Anda berada di luar radius sekolah',
          },
        },
      }),
    );
    const promise = fixture.componentInstance.checkIn();
    geolocation.successes[0]?.({
      coords: { latitude: -6.19, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await promise;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Anda berada di luar radius sekolah',
    );
    expect(fixture.nativeElement.textContent).toContain('-6.190000');
    expect(fixture.nativeElement.querySelector('app-teacher-location-map')).not.toBeNull();
    expect(fixture.componentInstance.actionInProgress()).toBe(false);
  });
});
