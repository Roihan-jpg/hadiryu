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
    punctualityTrend: [], activity: { data: [], pagination: { page: 1, pageSize: 8, totalItems: 0, totalPages: 1 } },
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
