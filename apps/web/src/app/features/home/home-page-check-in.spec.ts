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
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { RequestQuotasService } from '../request-quotas.service';

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
  let createLateArrival: ReturnType<typeof vi.fn>;
  let fetchQuota: ReturnType<typeof vi.fn>;

  async function setup(today = ready, quotaFailure = false): Promise<void> {
    geolocation = new FakeGeolocation();
    fetchToday = vi.fn(async () => today);
    checkIn = vi.fn(async () => checkedIn);
    queryPermission = vi.fn(async () => ({ state: 'prompt' as PermissionState }));
    createLateArrival = vi.fn(async () => ({
      id: '40000000-0000-4000-8000-000000000099',
      teacherId: teacher.id,
      leaveDate: today.workDate,
      leaveType: 'LATE_ARRIVAL' as const,
      reason: 'Terjebak lalu lintas',
      status: 'PENDING' as const,
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: today.serverNow,
      updatedAt: today.serverNow,
    }));
    fetchQuota = vi.fn(async () => {
      if (quotaFailure) throw new Error('quota unavailable');
      return {
      month: today.workDate.slice(0, 7),
      lateArrival: { limit: 2, used: 0, remaining: 2 },
      earlyDeparture: { limit: 2, used: 0, remaining: 2 },
      };
    });
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
        { provide: LeaveRequestsService, useValue: { create: createLateArrival } },
        { provide: RequestQuotasService, useValue: { fetch: fetchQuota } },
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

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

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

  it('offers a separate late-arrival action below check-in before attendance is recorded', async () => {
    await setup();

    const button = fixture.nativeElement.querySelector('button[data-action="late-arrival"]') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Ajukan izin terlambat');
  });

  it('hides the late-arrival action after check-in', async () => {
    await setup({ ...ready, state: 'CHECKED_IN', attendance: checkedIn });
    expect(fixture.nativeElement.querySelector('button[data-action="late-arrival"]')).toBeNull();
  });

  it('submits the inline late-arrival form for the active server work date', async () => {
    await setup();
    await vi.waitFor(() => expect(fixture.componentInstance.lateQuotaQuery.data()).toBeDefined());
    const button = fixture.nativeElement.querySelector('button[data-action="late-arrival"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    const page = fixture.componentInstance;
    page.lateArrivalForm.controls.reason.setValue('Terjebak lalu lintas');
    await page.submitLateArrival();
    fixture.detectChanges();

    expect(createLateArrival).toHaveBeenCalledWith({
      leaveDate: ready.workDate,
      leaveType: 'LATE_ARRIVAL',
      reason: 'Terjebak lalu lintas',
    });
    expect(fixture.nativeElement.textContent).toContain('Pengajuan izin terlambat berhasil dikirim');
  });

  it('passes an optional late-arrival attachment to the existing leave API', async () => {
    await setup();
    await vi.waitFor(() => expect(fixture.componentInstance.lateQuotaQuery.data()).toBeDefined());
    (fixture.nativeElement.querySelector('button[data-action="late-arrival"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const page = fixture.componentInstance;
    page.lateArrivalForm.controls.reason.setValue('Terjebak lalu lintas');
    const attachment = new File(['surat'], 'surat.pdf', { type: 'application/pdf' });
    page.lateArrivalAttachmentChanged({ target: { files: [attachment] } } as unknown as Event);
    await page.submitLateArrival();

    expect(createLateArrival).toHaveBeenCalledWith(expect.objectContaining({ leaveType: 'LATE_ARRIVAL' }), attachment);
  });

  it('shows a retry state instead of an endless loading message when quota lookup fails', async () => {
    await setup(ready, true);
    await vi.waitFor(() => expect(fixture.componentInstance.lateQuotaQuery.isError()).toBe(true));
    (fixture.nativeElement.querySelector('button[data-action="late-arrival"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Kuota izin terlambat tidak dapat dimuat');
    expect(fixture.nativeElement.textContent).toContain('Coba lagi');
    expect(fixture.nativeElement.textContent).not.toContain('Memuat kuota izin terlambat…');
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

  it('reuses a ready preview for check-in without requesting location again', async () => {
    await setup();
    fetchToday.mockResolvedValue({ ...ready, state: 'CHECKED_IN', attendance: checkedIn });

    const preview = fixture.componentInstance.showLocationPreview();
    geolocation.successes[0]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await preview;

    const attendance = fixture.componentInstance.checkIn();
    await attendance;

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
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
    expect(fixture.nativeElement.textContent).toContain('syarat maksimal 10 meter');
    expect(fixture.nativeElement.textContent).toContain('Belum siap');
  });

  it('joins an active preview and submits automatically when its location is ready', async () => {
    await setup();

    const preview = fixture.componentInstance.showLocationPreview();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('button[data-action="check-in"]').disabled,
    ).toBe(false);

    const attendance = fixture.componentInstance.checkIn();
    fixture.detectChanges();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(checkIn).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Menunggu lokasi siap');

    geolocation.successes[0]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await Promise.all([preview, attendance]);

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
  });

  it('refreshes a ready location when its 60-second cache has expired', async () => {
    await setup();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const preview = fixture.componentInstance.showLocationPreview();
    geolocation.successes[0]?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await preview;

    now += 60_000;
    const attendance = fixture.componentInstance.checkIn();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    geolocation.successes[1]?.({
      coords: { latitude: -6.21, longitude: 106.82, accuracy: 9 },
    } as GeolocationPosition);
    await attendance;

    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.21,
      longitude: 106.82,
      accuracyMeters: 9,
    });
  });

  it('marks the displayed location as needing refresh after 60 seconds', async () => {
    await setup();
    vi.useFakeTimers();
    try {
      const preview = fixture.componentInstance.showLocationPreview();
      geolocation.successes[0]?.({
        coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
      } as GeolocationPosition);
      await preview;
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Siap digunakan');

      await vi.advanceTimersByTimeAsync(60_000);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Perlu diperbarui');
      expect(fixture.nativeElement.textContent).toContain('sudah kedaluwarsa');
    } finally {
      vi.useRealTimers();
    }
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
