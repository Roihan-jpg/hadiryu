import type {
  AuthUser,
  CheckInRecord,
  CompletedAttendanceRecord,
  IncompleteAttendanceRecord,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GEOLOCATION } from '../attendance/geolocation';
import { HomePage } from './home-page';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Delapan',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};
const checkedIn: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:20.000Z',
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
const completed: CompletedAttendanceRecord = {
  ...checkedIn,
  checkOutAt: '2026-08-25T08:35:59.000Z',
  checkOutLatitude: -6.2,
  checkOutLongitude: 106.816666,
  checkOutAccuracyMeters: 10,
  checkOutDistanceMeters: 0,
  workedMinutes: 510,
  workDeficitMinutes: 5,
  status: 'COMPLETED',
};
const incomplete: IncompleteAttendanceRecord = {
  ...checkedIn,
  checkOutAt: null,
  workedMinutes: 455,
  workDeficitMinutes: 60,
  status: 'INCOMPLETE',
};
const schedule = {
  scheduleType: 'WEEKDAY' as const,
  checkInOpen: '05:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '12:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
};

class FakeGeolocation {
  success?: PositionCallback;
  readonly getCurrentPosition = vi.fn((success: PositionCallback) => {
    this.success = success;
  });
}

describe('HomePage checkout states', () => {
  let fixture: ComponentFixture<HomePage>;
  let geolocation: FakeGeolocation;
  let checkout: ReturnType<typeof vi.fn>;

  async function setup(today: TodayAttendanceResponse): Promise<void> {
    geolocation = new FakeGeolocation();
    checkout = vi.fn(async () => completed);
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
        {
          provide: AttendanceService,
          useValue: {
            getToday: vi.fn(async () => today),
            checkIn: vi.fn(),
            checkout,
          },
        },
        { provide: GEOLOCATION, useValue: geolocation },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('offers checkout for an open check-in and completes it from precise location', async () => {
    await setup({
      serverNow: '2026-08-25T08:00:00.000Z',
      workDate: '2026-08-25',
      state: 'CHECKED_IN',
      schedule,
      attendance: checkedIn,
    });

    expect(fixture.nativeElement.textContent).toContain('Checkout sekarang');
    const first = fixture.componentInstance.checkout();
    const repeated = fixture.componentInstance.checkout();
    fixture.detectChanges();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(
      fixture.nativeElement.querySelector('button[data-action="checkout"]').disabled,
    ).toBe(true);

    geolocation.success?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await Promise.all([first, repeated]);
    fixture.detectChanges();

    expect(checkout).toHaveBeenCalledTimes(1);
    expect(checkout).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
    expect(fixture.nativeElement.textContent).toContain('Absensi selesai');
    expect(fixture.nativeElement.textContent).toContain('510 menit');
    expect(fixture.nativeElement.textContent).toContain('Kekurangan5 menit');
  });

  it('shows derived incomplete values without offering checkout after cutoff', async () => {
    await setup({
      serverNow: '2026-08-25T10:01:00.000Z',
      workDate: '2026-08-25',
      state: 'INCOMPLETE',
      schedule,
      attendance: incomplete,
    });

    expect(fixture.nativeElement.textContent).toContain('Data tidak lengkap');
    expect(fixture.nativeElement.textContent).toContain('455 menit');
    expect(fixture.nativeElement.textContent).toContain('Kekurangan60 menit');
    expect(
      fixture.nativeElement.querySelector('button[data-action="checkout"]'),
    ).toBeNull();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('links the dashboard to the teacher history page', async () => {
    await setup({
      serverNow: completed.checkOutAt,
      workDate: completed.workDate,
      state: 'COMPLETED',
      schedule,
      attendance: completed,
    });

    const historyLink = fixture.nativeElement.querySelector('a[href="/guru/riwayat"]');
    expect(historyLink?.textContent).toContain('Lihat riwayat');
  });
});
