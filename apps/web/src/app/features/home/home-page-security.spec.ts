import type { AuthUser, SecurityGuardDashboardResponse, TodayAttendanceResponse } from '@absensi/contracts';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GEOLOCATION, GEOLOCATION_PERMISSIONS } from '../attendance/geolocation';
import { HomePage } from './home-page';
import { SecurityDashboardService } from './security-dashboard.service';

const guard: AuthUser = { id: '22222222-2222-4222-8222-222222222222', nip: 'satpam1', fullName: 'Wahid', role: 'SECURITY_GUARD', isActive: true, mustChangePassword: false };
const today: TodayAttendanceResponse = {
  serverNow: '2026-09-07T00:00:00.000Z', workDate: '2026-09-07', state: 'READY_TO_CHECK_IN', attendance: null,
  schedule: { scheduleType: 'SECURITY_NIGHT', checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00', checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720 },
  locationRequirement: { maxAccuracyMeters: 15 },
};
const dashboard: SecurityGuardDashboardResponse = {
  serverNow: today.serverNow, calendarDate: '2026-09-07',
  currentDuty: { workDate: '2026-09-07', rotationDay: 1, status: 'NIGHT', scheduleType: 'SECURITY_NIGHT', targetMinutes: 720, boundaries: { checkInOpenAt: '2026-09-07T10:00:00.000Z', workStartAt: '2026-09-07T11:00:00.000Z', checkInCloseAt: '2026-09-07T13:00:00.000Z', checkoutOpenAt: '2026-09-07T22:00:00.000Z', workEndAt: '2026-09-07T23:00:00.000Z', checkoutCloseAt: '2026-09-08T01:00:00.000Z' } },
  activeDuty: null, activeAttendance: null, latestAttendance: null,
  nextWorkingDuty: { workDate: '2026-09-09', rotationDay: 3, status: 'DAY', scheduleType: 'SECURITY_DAY', targetMinutes: 720, boundaries: null },
  locationRequirement: { maxAccuracyMeters: 15 },
};

class FakeGeolocation {
  success?: PositionCallback;
  readonly getCurrentPosition = vi.fn((success: PositionCallback) => {
    this.success = success;
  });
}

describe('HomePage Satpam dashboard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows a status-first overnight timeline and Satpam self-service routes', async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: AuthService, useValue: { user: signal(guard).asReadonly(), logout: vi.fn() } },
        { provide: AttendanceService, useValue: { fetchToday: vi.fn(async () => today), checkIn: vi.fn(), checkout: vi.fn() } },
        { provide: SecurityDashboardService, useValue: { getDashboard: vi.fn(async () => dashboard) } },
        { provide: GEOLOCATION, useValue: null },
        { provide: GEOLOCATION_PERMISSIONS, useValue: null },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.securityDashboard()).not.toBeNull());
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Tugas kalender hari ini');
    expect(text).toContain('Shift Malam');
    expect(text).toContain('Hari berikutnya');
    expect(fixture.nativeElement.querySelector('a[href="/satpam/riwayat"]')).not.toBeNull();
  });

  it('reuses the same ready preview when a Satpam checks in', async () => {
    const geolocation = new FakeGeolocation();
    const checkIn = vi.fn(async () => ({
      id: '40000000-0000-4000-8000-000000000002',
      workDate: today.workDate,
      checkInAt: '2026-09-07T11:05:00.000Z',
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
      distanceMeters: 0,
      workStart: '18:00',
      workEnd: '06:00',
      checkoutClose: '08:00',
      targetMinutes: 720,
      arrivalLateMinutes: 5,
      status: 'CHECKED_IN' as const,
    }));
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: AuthService, useValue: { user: signal(guard).asReadonly(), logout: vi.fn() } },
        { provide: AttendanceService, useValue: { fetchToday: vi.fn(async () => today), checkIn, checkout: vi.fn() } },
        { provide: SecurityDashboardService, useValue: { getDashboard: vi.fn(async () => dashboard) } },
        { provide: GEOLOCATION, useValue: geolocation },
        { provide: GEOLOCATION_PERMISSIONS, useValue: null },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.today()).not.toBeNull());

    const preview = fixture.componentInstance.showLocationPreview();
    geolocation.success?.({
      coords: { latitude: -6.2, longitude: 106.816666, accuracy: 10 },
    } as GeolocationPosition);
    await preview;
    await fixture.componentInstance.checkIn();
    fixture.detectChanges();

    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(checkIn).toHaveBeenCalledWith({
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    });
    expect(fixture.nativeElement.textContent).toContain('Terlambat 5 menit.');
  });
});
