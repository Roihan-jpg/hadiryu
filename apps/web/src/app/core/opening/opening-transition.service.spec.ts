import type { AuthUser } from '@absensi/contracts';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminDashboardService } from '../../features/admin/attendance/admin-dashboard.service';
import { AttendanceService } from '../../features/attendance/attendance.service';
import { appQueryClient } from '../query/query-client';
import { queryKeys } from '../query/query-keys';
import { OpeningTransitionService } from './opening-transition.service';

const teacher: AuthUser = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: '1987001',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

const admin: AuthUser = {
  ...teacher,
  id: '50000000-0000-4000-8000-000000000002',
  nip: '1987002',
  fullName: 'Admin Contoh',
  role: 'SUPER_ADMIN',
};

describe('OpeningTransitionService', () => {
  const fetchToday = vi.fn();
  const fetchList = vi.fn();
  let routerEvents: Subject<NavigationEnd>;

  beforeEach(() => {
    vi.useFakeTimers();
    appQueryClient.clear();
    fetchToday.mockReset();
    fetchList.mockReset();
    routerEvents = new Subject<NavigationEnd>();
    TestBed.configureTestingModule({
      providers: [
        { provide: AttendanceService, useValue: { fetchToday } },
        { provide: AdminDashboardService, useValue: { fetchList } },
        {
          provide: Router,
          useValue: { navigated: false, events: routerEvents.asObservable() },
        },
      ],
    });
  });

  it('uses the opening as an initial-page splash until navigation and active queries settle', async () => {
    let finishPageQuery!: (value: string) => void;
    const pageQuery = appQueryClient.fetchQuery({
      queryKey: ['initial-page'],
      queryFn: () => new Promise<string>((resolve) => { finishPageQuery = resolve; }),
    });
    const service = TestBed.inject(OpeningTransitionService);

    const splash = service.playInitialLoad();
    expect(service.phase()).toBe('showing');
    expect(fetchToday).not.toHaveBeenCalled();
    expect(fetchList).not.toHaveBeenCalled();

    routerEvents.next(new NavigationEnd(1, '/guru/riwayat', '/guru/riwayat'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.phase()).toBe('showing');

    finishPageQuery('ready');
    await pageQuery;
    await vi.advanceTimersByTimeAsync(0);
    expect(service.phase()).toBe('leaving');

    await vi.advanceTimersByTimeAsync(300);
    await splash;
    expect(service.phase()).toBe('idle');
  });

  afterEach(() => {
    appQueryClient.clear();
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('keeps the teacher opening visible until the minimum time and today query are ready', async () => {
    let finishQuery!: (value: { workDate: string }) => void;
    fetchToday.mockReturnValue(new Promise((resolve) => { finishQuery = resolve; }));
    const service = TestBed.inject(OpeningTransitionService);

    const opening = service.play(teacher);
    expect(service.phase()).toBe('showing');
    expect(fetchToday).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.phase()).toBe('showing');

    finishQuery({ workDate: '2026-09-07' });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.phase()).toBe('leaving');

    await vi.advanceTimersByTimeAsync(300);
    await opening;
    expect(service.phase()).toBe('idle');
    expect(appQueryClient.getQueryData(queryKeys.attendance('today'))).toEqual({
      workDate: '2026-09-07',
    });
  });

  it('prefetches only the initial admin monitoring query', async () => {
    fetchList.mockResolvedValue({ summary: { workDate: '2026-09-07' }, data: [] });
    const service = TestBed.inject(OpeningTransitionService);

    const opening = service.play(admin);
    expect(fetchList).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(fetchToday).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_300);
    await opening;
    expect(service.phase()).toBe('idle');
    expect(appQueryClient.getQueryData(queryKeys.monitoring({ page: 1, pageSize: 20 }))).toEqual({
      summary: { workDate: '2026-09-07' },
      data: [],
    });
  });

  it('does not prefetch dashboard data before a required password change', async () => {
    const service = TestBed.inject(OpeningTransitionService);

    const opening = service.play({ ...teacher, mustChangePassword: true });
    expect(fetchToday).not.toHaveBeenCalled();
    expect(fetchList).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_300);
    await opening;
    expect(service.phase()).toBe('idle');
  });
});
