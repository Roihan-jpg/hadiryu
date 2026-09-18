import type { AuthUser, StaffDashboardResponse, TeacherStreak } from '@absensi/contracts';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { StaffDashboardPage, streakAnimationUrl } from './staff-dashboard-page';
import { StaffDashboardService } from './staff-dashboard.service';

const teacher: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111', nip: '1001', fullName: 'Rani',
  role: 'USER', isActive: true, mustChangePassword: false,
};

function dashboard(streak: TeacherStreak): StaffDashboardResponse {
  return {
    serverNow: '2026-09-13T01:00:00.000Z', role: 'USER', month: '2026-09',
    todayAttendance: {
      serverNow: '2026-09-13T01:00:00.000Z', workDate: '2026-09-13', state: 'NON_WORKING_DAY',
      schedule: null, attendance: null,
    },
    securityDuty: null,
    requestQuotas: {
      month: '2026-09', lateArrival: { limit: 2, used: 0, remaining: 2 },
      earlyDeparture: { limit: 2, used: 0, remaining: 2 },
    },
    metrics: {
      attendanceDays: 0, onTimeDays: 0, actualLateDays: 0, effectiveLateDays: 0,
      lateArrivalPermissionDays: 0, totalWorkedMinutes: 0, totalWorkDeficitMinutes: 0,
    },
    punctualityTrend: [],
    attendanceTrend: [
      {
        workDate: '2026-09-10', status: 'COMPLETED', targetMinutes: 515,
        actual: { checkInAt: '2026-09-10T00:15:00.000Z', checkOutAt: '2026-09-10T08:30:00.000Z', arrivalOffsetMinutes: -15, lateMinutes: 15, workedMinutes: 495, workDeficitMinutes: 20 },
        effective: { arrivalOffsetMinutes: 0, lateMinutes: 0, workedMinutes: 510, workDeficitMinutes: 5 },
        credit: { lateArrival: true, earlyDeparture: false },
      },
      {
        workDate: '2026-09-11', status: 'LEAVE_APPROVED', targetMinutes: 515,
        actual: null, effective: null, credit: { lateArrival: false, earlyDeparture: false },
      },
      {
        workDate: '2026-09-12', status: 'NON_WORKING_DAY', targetMinutes: null,
        actual: null, effective: null, credit: { lateArrival: false, earlyDeparture: false },
      },
    ],
    activity: { data: [], pagination: { page: 1, pageSize: 8, totalItems: 0, totalPages: 1 } },
    latestEarlyDeparture: null, streak,
  };
}

function available(tier: 'NONE' | 'RED' | 'BLUE' | 'PURPLE'): TeacherStreak {
  return {
    status: 'AVAILABLE', currentDays: tier === 'PURPLE' ? 14 : tier === 'BLUE' ? 7 : tier === 'RED' ? 3 : 0,
    tier, nextMilestone: tier === 'NONE' ? 3 : tier === 'RED' ? 7 : tier === 'BLUE' ? 14 : null,
    daysRemaining: tier === 'NONE' ? 3 : tier === 'RED' ? 4 : tier === 'BLUE' ? 7 : 0, provisional: false,
  };
}

describe('StaffDashboardPage streak animation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('maps active tiers to their public animation assets', () => {
    expect(streakAnimationUrl(available('RED'))).toBe('https://jlqzeytwwdnooepagknb.supabase.co/storage/v1/object/public/streak/api-merah.webm');
    expect(streakAnimationUrl(available('BLUE'))).toBe('https://jlqzeytwwdnooepagknb.supabase.co/storage/v1/object/public/streak/api-biru.webm');
    expect(streakAnimationUrl(available('PURPLE'))).toBe('https://jlqzeytwwdnooepagknb.supabase.co/storage/v1/object/public/streak/api-merah.webm');
    expect(streakAnimationUrl(available('NONE'))).toBeNull();
    expect(streakAnimationUrl({ status: 'UNAVAILABLE', reason: 'CONFIGURATION_MISSING' })).toBeNull();
  });

  it('marks the desktop status time for its compact desktop typography', async () => {
    const fixture = await setup(available('NONE'));

    expect(fixture.nativeElement.querySelector('.today-stat--desktop-balanced')).not.toBeNull();
  });

  it('labels and groups the month and activity filters for accessible responsive styling', async () => {
    const fixture = await setup(available('NONE'));
    const month = fixture.nativeElement.querySelector('#dashboard-month') as HTMLInputElement | null;
    const type = fixture.nativeElement.querySelector('#dashboard-type') as HTMLSelectElement | null;

    expect(month?.labels?.[0]?.textContent).toContain('Bulan');
    expect(type?.labels?.[0]?.textContent).toContain('Jenis aktivitas');
    expect(month?.closest('.dashboard-filter-field')).not.toBeNull();
    expect(type?.closest('.dashboard-filter-field')).not.toBeNull();
  });

  it('renders the layered attendance trend with daily server statuses and keyboard-readable detail', async () => {
    const fixture = await setup(available('NONE'));
    const trend = fixture.nativeElement.querySelector('#attendance-trend-title') as HTMLElement | null;
    const day = fixture.nativeElement.querySelector('.attendance-trend-day') as HTMLButtonElement | null;

    expect(trend?.textContent).toContain('Ringkasan kehadiran');
    expect(fixture.nativeElement.textContent).toContain('Aktual dan efektif');
    expect(fixture.nativeElement.querySelectorAll('.attendance-trend-status .attendance-trend-day')).toHaveLength(3);
    expect(day?.getAttribute('aria-label')).toContain('10 Sep 2026');
    expect(day?.getAttribute('aria-label')).toContain('Izin terlambat memberi kredit');
  });

  async function setup(streak: TeacherStreak) {
    await TestBed.configureTestingModule({
      imports: [StaffDashboardPage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
        { provide: AuthService, useValue: { user: signal(teacher).asReadonly() } },
        { provide: StaffDashboardService, useValue: { fetch: vi.fn(async () => dashboard(streak)) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(StaffDashboardPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.dashboard()).toBeDefined());
    fixture.detectChanges();
    return fixture;
  }

  it('plays the red tier animation inline and falls back to SVG when the media fails', async () => {
    const fixture = await setup(available('RED'));
    const video = fixture.nativeElement.querySelector('.fire-slot video') as HTMLVideoElement | null;

    expect(video?.src).toBe('https://jlqzeytwwdnooepagknb.supabase.co/storage/v1/object/public/streak/api-merah.webm');
    expect(video?.autoplay).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);

    video?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.fire-slot video')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fire-slot svg')).not.toBeNull();
  });

  it('uses the red animation temporarily for the purple tier and retains SVG for NONE', async () => {
    const purpleFixture = await setup(available('PURPLE'));
    expect((purpleFixture.nativeElement.querySelector('.fire-slot video') as HTMLVideoElement | null)?.src)
      .toBe('https://jlqzeytwwdnooepagknb.supabase.co/storage/v1/object/public/streak/api-merah.webm');

    TestBed.resetTestingModule();
    const noneFixture = await setup(available('NONE'));
    expect(noneFixture.nativeElement.querySelector('.fire-slot video')).toBeNull();
    expect(noneFixture.nativeElement.querySelector('.fire-slot svg')).not.toBeNull();
  });
});
