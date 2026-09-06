import type {
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { AttendanceService } from '../attendance/attendance.service';
import {
  acquireLocationPreview,
  acquirePreciseLocation,
  GEOLOCATION,
  GEOLOCATION_PERMISSIONS,
  PreciseLocationError,
  type LocationAccuracyProgress,
} from '../attendance/geolocation';
import { TeacherLocationMap } from './teacher-location-map';

type PermissionState =
  | 'IDLE'
  | 'REQUESTING'
  | 'GRANTED'
  | 'DENIED'
  | 'SYSTEM_DENIED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INACCURATE';

class LocationRequestError extends Error {
  constructor(
    readonly permissionState: Exclude<PermissionState, 'IDLE' | 'REQUESTING' | 'GRANTED'>,
    readonly bestAccuracyMeters?: number,
  ) {
    super(permissionState);
  }
}

@Component({
  imports: [
    MatButtonModule,
    MatProgressSpinnerModule,
    RouterLink,
    TeacherLocationMap,
  ],
  selector: 'app-home-page',
  styleUrl: './home-page.scss',
  templateUrl: './home-page.html',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly geolocationPermissions = inject(GEOLOCATION_PERMISSIONS);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly roleLabel = computed(() =>
    this.user()?.role === 'SUPER_ADMIN' ? 'SuperAdmin' : 'Guru',
  );
  readonly todayQuery = injectQuery(() => ({
    queryKey: queryKeys.attendance('today'),
    queryFn: () => this.attendanceService.fetchToday(),
    enabled: this.user()?.role === 'USER',
  }));
  readonly today = computed<TodayAttendanceResponse | null>(() => this.todayQuery.data() ?? null);
  readonly loadingToday = computed(() => this.todayQuery.isPending());
  readonly actionInProgress = signal(false);
  readonly locationPreviewInProgress = signal(false);
  readonly locationRequestInProgress = computed(
    () => this.actionInProgress() || this.locationPreviewInProgress(),
  );
  readonly locationPreview = signal<LocationInput | null>(null);
  readonly locationAccuracyProgress = signal<LocationAccuracyProgress | null>(null);
  readonly permissionState = signal<PermissionState>('IDLE');
  readonly errorMessage = signal<string | null>(null);
  readonly locationPreviewError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly workDateLabel = computed(() => {
    const workDate = this.today()?.workDate;
    if (!workDate) return '';
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  });

  readonly todayErrorMessage = computed(() => this.todayQuery.isError()
    ? 'Status absensi hari ini tidak dapat dimuat. Periksa koneksi lalu coba lagi.'
    : null);

  loadToday(): void {
    void this.todayQuery.refetch();
  }

  async checkIn(): Promise<void> {
    if (this.locationRequestInProgress()) return;
    this.actionInProgress.set(true);
    this.permissionState.set('REQUESTING');
    this.errorMessage.set(null);
    this.locationPreview.set(null);
    this.locationPreviewError.set(null);
    this.successMessage.set(null);
    this.locationAccuracyProgress.set(null);
    try {
      const location = await this.currentLocation('ATTENDANCE');
      this.permissionState.set('GRANTED');
      this.locationPreview.set(location);
      const attendance = await this.attendanceService.checkIn(location);
      await this.todayQuery.refetch();
      this.successMessage.set(
        `Check-in berhasil dicatat pukul ${this.jakartaTime(attendance.checkInAt)}.`,
      );
    } catch (error) {
      if (error instanceof LocationRequestError) {
        this.permissionState.set(error.permissionState);
        this.errorMessage.set(this.locationErrorText(
          error.permissionState,
          error.bestAccuracyMeters,
        ));
      } else {
        this.errorMessage.set(await this.apiErrorText(error, 'check-in'));
      }
    } finally {
      this.actionInProgress.set(false);
    }
  }

  async checkout(): Promise<void> {
    if (this.locationRequestInProgress()) return;
    this.actionInProgress.set(true);
    this.permissionState.set('REQUESTING');
    this.errorMessage.set(null);
    this.locationPreview.set(null);
    this.locationPreviewError.set(null);
    this.successMessage.set(null);
    this.locationAccuracyProgress.set(null);
    try {
      const location = await this.currentLocation('ATTENDANCE');
      this.permissionState.set('GRANTED');
      this.locationPreview.set(location);
      const attendance = await this.attendanceService.checkout(location);
      await this.todayQuery.refetch();
      this.successMessage.set(
        `Checkout berhasil dicatat pukul ${this.jakartaTime(attendance.checkOutAt)}.`,
      );
    } catch (error) {
      if (error instanceof LocationRequestError) {
        this.permissionState.set(error.permissionState);
        this.errorMessage.set(this.locationErrorText(
          error.permissionState,
          error.bestAccuracyMeters,
        ));
      } else {
        this.errorMessage.set(await this.apiErrorText(error, 'checkout'));
      }
    } finally {
      this.actionInProgress.set(false);
    }
  }

  jakartaTime(timestamp: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(timestamp));
  }

  async showLocationPreview(): Promise<void> {
    if (this.locationRequestInProgress()) return;

    this.locationPreviewInProgress.set(true);
    this.locationPreview.set(null);
    this.locationPreviewError.set(null);
    this.permissionState.set('REQUESTING');
    this.locationAccuracyProgress.set(null);
    try {
      const location = await this.currentLocation('PREVIEW');
      this.permissionState.set('GRANTED');
      this.locationPreview.set(location);
    } catch (error) {
      if (error instanceof LocationRequestError) {
        this.permissionState.set(error.permissionState);
        this.locationPreviewError.set(
          this.locationErrorText(error.permissionState, error.bestAccuracyMeters),
        );
      } else {
        this.locationPreviewError.set(
          'Lokasi belum dapat ditampilkan. Periksa perangkat lalu coba lagi.',
        );
      }
    } finally {
      this.locationPreviewInProgress.set(false);
    }
  }

  coordinateText(value: number): string {
    return value.toFixed(6);
  }

  accuracyText(value: number): string {
    return `${Math.round(value)} meter`;
  }

  profilePhotoUrl(updatedAt: string): string {
    return `/api/profile/photo?v=${encodeURIComponent(updatedAt)}`;
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private async currentLocation(mode: 'ATTENDANCE' | 'PREVIEW'): Promise<LocationInput> {
    if (!this.geolocation) {
      throw new LocationRequestError('UNAVAILABLE');
    }

    try {
      return await this.requestCurrentLocation(mode, true);
    } catch (error) {
      if (
        !(error instanceof LocationRequestError) ||
        error.permissionState !== 'DENIED' ||
        !(await this.isLocationPermissionGranted())
      ) {
        throw error;
      }

      try {
        return await this.requestCurrentLocation(mode, false);
      } catch (fallbackError) {
        if (
          fallbackError instanceof LocationRequestError &&
          fallbackError.permissionState === 'DENIED'
        ) {
          throw new LocationRequestError('SYSTEM_DENIED');
        }
        throw fallbackError;
      }
    }
  }

  private requestCurrentLocation(
    mode: 'ATTENDANCE' | 'PREVIEW',
    enableHighAccuracy: boolean,
  ): Promise<LocationInput> {
    const request = mode === 'PREVIEW'
      ? acquireLocationPreview(this.geolocation!, enableHighAccuracy)
      : this.acquireAttendanceLocation(enableHighAccuracy);
    return request.catch((error: unknown) => {
      if (error instanceof PreciseLocationError) {
        throw new LocationRequestError(error.state, error.bestAccuracyMeters);
      }
      throw error;
    });
  }

  private acquireAttendanceLocation(enableHighAccuracy: boolean): Promise<LocationInput> {
    const maxAccuracyMeters =
      this.today()?.locationRequirement?.maxAccuracyMeters ?? 15;
    return acquirePreciseLocation(
      this.geolocation!,
      maxAccuracyMeters,
      (progress) => this.locationAccuracyProgress.set(progress),
      enableHighAccuracy,
    );
  }

  private async isLocationPermissionGranted(): Promise<boolean> {
    if (!this.geolocationPermissions) return false;
    try {
      const permission = await this.geolocationPermissions.query({
        name: 'geolocation',
      });
      return permission.state === 'granted';
    } catch {
      return false;
    }
  }

  private locationErrorText(state: PermissionState, bestAccuracyMeters?: number): string {
    if (state === 'DENIED') {
      return 'Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu coba lagi.';
    }
    if (state === 'SYSTEM_DENIED') {
      return 'Izin situs sudah aktif, tetapi browser belum dapat membaca lokasi perangkat. Pastikan akses lokasi untuk aplikasi desktop aktif, lalu coba lagi atau gunakan browser lain.';
    }
    if (state === 'TIMEOUT') {
      return 'Lokasi belum ditemukan. Berpindah ke area terbuka lalu coba lagi.';
    }
    if (state === 'INACCURATE') {
      const progress = this.locationAccuracyProgress();
      const best = progress?.bestAccuracyMeters ?? bestAccuracyMeters;
      const maximum = progress?.maxAccuracyMeters ??
        this.today()?.locationRequirement?.maxAccuracyMeters ?? 15;
      return best !== undefined
        ? `Akurasi terbaik ${Math.round(best)} meter, sedangkan syarat maksimal ${maximum} meter. Bergerak ke tengah halaman terbuka lalu coba lagi.`
        : 'Akurasi lokasi belum memenuhi syarat. Bergerak ke tengah halaman terbuka lalu coba lagi.';
    }
    return 'Lokasi tidak tersedia. Pastikan layanan lokasi perangkat aktif lalu coba lagi.';
  }

  private async apiErrorText(
    error: unknown,
    action: 'check-in' | 'checkout',
  ): Promise<string> {
    if (error instanceof HttpErrorResponse) {
      const { ApiErrorSchema } = await import('@absensi/contracts');
      const parsed = ApiErrorSchema.safeParse(error.error);
      if (parsed.success) return parsed.data.error.message;
    }
    return `${action === 'check-in' ? 'Check-in' : 'Checkout'} belum dapat disimpan. Periksa koneksi lalu coba lagi.`;
  }
}
