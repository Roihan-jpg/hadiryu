import type {
  AuthUser,
  CheckInRecord,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import {
  AttendanceService,
} from '../attendance/attendance.service';
import { GEOLOCATION } from '../attendance/geolocation';
import { HomePage } from './home-page';

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
    workEnd: '15:35',
    targetMinutes: 515,
  },
  attendance: null,
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
  success?: PositionCallback;
  failure?: PositionErrorCallback;
  readonly getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
    ) => {
      this.success = success;
      this.failure = failure ?? undefined;
    },
  );
}

describe('HomePage check-in', () => {
  let fixture: ComponentFixture<HomePage>;
  let geolocation: FakeGeolocation;
  let getToday: ReturnType<typeof vi.fn>;
  let checkIn: ReturnType<typeof vi.fn>;

  async function setup(today = ready): Promise<void> {
    geolocation = new FakeGeolocation();
    getToday = vi.fn(async () => today);
    checkIn = vi.fn(async () => checkedIn);
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: signal<AuthUser | null>(teacher).asReadonly(),
            logout: vi.fn(async () => undefined),
          },
        },
        { provide: AttendanceService, useValue: { getToday, checkIn } },
        { provide: GEOLOCATION, useValue: geolocation },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads today without requesting location when the page opens', async () => {
    await setup();

    expect(getToday).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Belum check-in');
    expect(fixture.nativeElement.textContent).toContain('Dibuka05:30');
    expect(fixture.nativeElement.textContent).toContain('Ditutup08:00');
    expect(fixture.nativeElement.textContent).toContain('Check-in sekarang');
  });

  it('requests precise current location from the button and prevents double submit', async () => {
    await setup();

    const first = fixture.componentInstance.checkIn();
    const repeated = fixture.componentInstance.checkIn();
    fixture.detectChanges();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    expect(fixture.componentInstance.permissionState()).toBe('REQUESTING');
    expect(
      fixture.nativeElement.querySelector('button[data-action="check-in"]').disabled,
    ).toBe(true);

    geolocation.success?.({
      coords: {
        latitude: -6.2,
        longitude: 106.816666,
        accuracy: 10,
      },
    } as GeolocationPosition);
    await Promise.all([first, repeated]);
    fixture.detectChanges();

    expect(checkIn).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
    expect(fixture.componentInstance.permissionState()).toBe('GRANTED');
    expect(fixture.nativeElement.textContent).toContain('Check-in berhasil');
    expect(fixture.nativeElement.textContent).toContain('Sudah check-in');
  });

  it('shows actionable permission guidance without calling the API', async () => {
    await setup();
    const promise = fixture.componentInstance.checkIn();
    geolocation.failure?.({ code: 1 } as GeolocationPositionError);
    await promise;
    fixture.detectChanges();

    expect(checkIn).not.toHaveBeenCalled();
    expect(fixture.componentInstance.permissionState()).toBe('DENIED');
    expect(fixture.nativeElement.textContent).toContain(
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
    geolocation.success?.({
      coords: { latitude: -6.19, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await promise;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Anda berada di luar radius sekolah',
    );
    expect(fixture.componentInstance.actionInProgress()).toBe(false);
  });
});
