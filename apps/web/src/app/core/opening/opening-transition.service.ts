import type { AuthUser } from '@absensi/contracts';
import { inject, Injectable, signal } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  Router,
} from '@angular/router';

import { AdminDashboardService } from '../../features/admin/attendance/admin-dashboard.service';
import { AttendanceService } from '../../features/attendance/attendance.service';
import { appQueryClient } from '../query/query-client';
import { queryKeys } from '../query/query-keys';

export type OpeningPhase = 'idle' | 'showing' | 'leaving';

const MINIMUM_DISPLAY_MS = 1_000;
const FADE_OUT_MS = 300;
const INITIAL_ADMIN_QUERY = { page: 1, pageSize: 20 } as const;

@Injectable({ providedIn: 'root' })
export class OpeningTransitionService {
  private readonly attendance = inject(AttendanceService);
  private readonly adminDashboard = inject(AdminDashboardService);
  private readonly router = inject(Router);
  private readonly queryClient = appQueryClient;
  private readonly currentPhase = signal<OpeningPhase>('idle');
  private running: Promise<void> | null = null;
  private initialLoadPlayed = false;

  readonly phase = this.currentPhase.asReadonly();

  playInitialLoad(): Promise<void> {
    if (this.initialLoadPlayed) return this.running ?? Promise.resolve();
    this.initialLoadPlayed = true;
    return this.start(async () => {
      await this.waitForInitialNavigation();
      await this.delay(0);
      await this.waitForActiveQueries();
    });
  }

  play(user: AuthUser): Promise<void> {
    return this.start(() => this.prefetchInitialPage(user));
  }

  private start(prepare: () => Promise<void>): Promise<void> {
    if (this.running) return this.running;

    this.currentPhase.set('showing');
    this.running = this.run(prepare).finally(() => {
      this.currentPhase.set('idle');
      this.running = null;
    });
    return this.running;
  }

  private async run(prepare: () => Promise<void>): Promise<void> {
    await Promise.all([
      this.delay(MINIMUM_DISPLAY_MS),
      prepare(),
    ]);
    this.currentPhase.set('leaving');
    await this.delay(FADE_OUT_MS);
  }

  private waitForInitialNavigation(): Promise<void> {
    if (this.router.navigated) return Promise.resolve();

    return new Promise((resolve) => {
      const subscription = this.router.events.subscribe((event) => {
        if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          subscription.unsubscribe();
          resolve();
        }
      });
    });
  }

  private waitForActiveQueries(): Promise<void> {
    if (this.queryClient.isFetching() === 0) return Promise.resolve();

    return new Promise((resolve) => {
      let unsubscribe: () => void = () => undefined;
      const finishWhenReady = () => {
        if (this.queryClient.isFetching() !== 0) return;
        unsubscribe();
        resolve();
      };
      unsubscribe = this.queryClient.getQueryCache().subscribe(finishWhenReady);
      finishWhenReady();
    });
  }

  private async prefetchInitialPage(user: AuthUser): Promise<void> {
    if (user.mustChangePassword) return;

    if (user.role === 'SUPER_ADMIN') {
      await this.queryClient.prefetchQuery({
        queryKey: queryKeys.monitoring(INITIAL_ADMIN_QUERY),
        queryFn: () => this.adminDashboard.fetchList(INITIAL_ADMIN_QUERY),
      });
      return;
    }

    await this.queryClient.prefetchQuery({
      queryKey: queryKeys.attendance('today'),
      queryFn: () => this.attendance.fetchToday(),
    });
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }
}
