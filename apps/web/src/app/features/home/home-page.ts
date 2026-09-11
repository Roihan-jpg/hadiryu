import type {
  LocationInput,
  SecurityDuty,
  SecurityGuardDashboardResponse,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { AttendanceService } from '../attendance/attendance.service';
import {
  acquirePreciseLocation,
  GEOLOCATION,
  GEOLOCATION_PERMISSIONS,
  PreciseLocationError,
  type LocationAccuracyProgress,
} from '../attendance/geolocation';
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { RequestQuotasService } from '../request-quotas.service';
import { TeacherLocationMap } from './teacher-location-map';
import { SecurityDashboardService } from './security-dashboard.service';

type LocationAcquisitionState =
  | 'IDLE'
  | 'SEARCHING'
  | 'IMPROVING'
  | 'READY'
  | 'STALE'
  | 'ERROR';

interface CachedAttendanceLocation {
  location: LocationInput;
  expiresAt: number;
}

const LOCATION_CACHE_TTL_MS = 60_000;

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
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly geolocationPermissions = inject(GEOLOCATION_PERMISSIONS);
  private readonly leaveRequestsService = inject(LeaveRequestsService);
  private readonly requestQuotasService = inject(RequestQuotasService);
  private readonly router = inject(Router);
  private readonly securityDashboardService = inject(SecurityDashboardService, { optional: true });

  readonly user = this.auth.user;
  readonly roleLabel = computed(() =>
    this.user()?.role === 'SUPER_ADMIN' ? 'SuperAdmin' : this.user()?.role === 'SECURITY_GUARD' ? 'Satpam' : 'Guru',
  );
  readonly todayQuery = injectQuery(() => ({
    queryKey: queryKeys.attendance('today'),
    queryFn: () => this.attendanceService.fetchToday(),
    enabled: this.user()?.role === 'USER' || this.user()?.role === 'SECURITY_GUARD',
  }));
  readonly today = computed<TodayAttendanceResponse | null>(() => this.todayQuery.data() ?? null);
  readonly securityDashboardQuery = injectQuery(() => ({
    queryKey: queryKeys.securityDashboard,
    queryFn: () => this.securityDashboardService!.getDashboard(),
    enabled: this.user()?.role === 'SECURITY_GUARD',
  }));
  readonly securityDashboard = computed<SecurityGuardDashboardResponse | null>(() => this.securityDashboardQuery.data() ?? null);
  readonly loadingToday = computed(() => this.todayQuery.isPending());
  readonly actionInProgress = signal(false);
  readonly locationPreviewInProgress = signal(false);
  readonly locationRequestInProgress = computed(
    () => this.actionInProgress() || this.locationPreviewInProgress(),
  );
  readonly locationPreview = signal<LocationInput | null>(null);
  readonly locationAccuracyProgress = signal<LocationAccuracyProgress | null>(null);
  readonly locationAcquisitionState = signal<LocationAcquisitionState>('IDLE');
  readonly permissionState = signal<PermissionState>('IDLE');
  readonly errorMessage = signal<string | null>(null);
  readonly locationPreviewError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly lateArrivalOpen = signal(false);
  readonly lateArrivalSubmitting = signal(false);
  readonly lateArrivalError = signal<string | null>(null);
  readonly lateArrivalSuccess = signal<string | null>(null);
  readonly lateArrivalAttachment = signal<File | undefined>(undefined);
  readonly lateArrivalForm = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)],
    }),
  });
  readonly lateArrivalMonth = computed(() => this.today()?.workDate.slice(0, 7) ?? '');
  readonly lateQuotaQuery = injectQuery(() => ({
    queryKey: queryKeys.requestQuotas(this.lateArrivalMonth()),
    queryFn: () => this.requestQuotasService.fetch(this.lateArrivalMonth()),
    enabled: this.today()?.state === 'READY_TO_CHECK_IN' && this.lateArrivalMonth().length === 7,
  }));
  readonly lateArrivalAvailable = computed(() => this.today()?.state === 'READY_TO_CHECK_IN');
  readonly lateArrivalSubmitDisabled = computed(() =>
    this.lateArrivalSubmitting() ||
    this.lateQuotaQuery.isPending() ||
    this.lateQuotaQuery.isError() ||
    this.lateQuotaQuery.data()?.lateArrival.remaining === 0,
  );
  readonly lateQuotaMessage = computed(() => {
    if (this.lateQuotaQuery.isPending()) return 'Memuat kuota izin terlambat…';
    if (this.lateQuotaQuery.isError()) return 'Kuota izin terlambat tidak dapat dimuat.';
    const quota = this.lateQuotaQuery.data()?.lateArrival;
    return quota ? `Sisa izin terlambat bulan ini: ${quota.remaining} dari ${quota.limit}.` : '';
  });
  private locationAcquisition: Promise<LocationInput> | null = null;
  private cachedAttendanceLocation: CachedAttendanceLocation | null = null;
  private locationExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
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

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.cachedAttendanceLocation = null;
      this.clearLocationExpiryTimer();
    });
  }

  loadToday(): void {
    void this.todayQuery.refetch();
    if (this.user()?.role === 'SECURITY_GUARD') void this.securityDashboardQuery.refetch();
  }

  async checkIn(): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(true);
    this.errorMessage.set(null);
    this.locationPreviewError.set(null);
    this.successMessage.set(null);
    try {
      const location = await this.attendanceLocation();
      const attendance = await this.attendanceService.checkIn(location);
      await this.todayQuery.refetch();
      if (this.user()?.role === 'SECURITY_GUARD') await this.securityDashboardQuery.refetch();
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
    if (this.actionInProgress()) return;
    this.actionInProgress.set(true);
    this.errorMessage.set(null);
    this.locationPreviewError.set(null);
    this.successMessage.set(null);
    try {
      const location = await this.attendanceLocation();
      const attendance = await this.attendanceService.checkout(location);
      await this.todayQuery.refetch();
      if (this.user()?.role === 'SECURITY_GUARD') await this.securityDashboardQuery.refetch();
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

  toggleLateArrival(): void {
    if (!this.lateArrivalAvailable()) return;
    this.lateArrivalOpen.update((value) => !value);
    this.lateArrivalError.set(null);
    this.lateArrivalSuccess.set(null);
  }

  lateArrivalAttachmentChanged(event: Event): void {
    this.lateArrivalAttachment.set((event.target as HTMLInputElement).files?.[0]);
  }

  async retryLateQuota(): Promise<void> {
    await this.lateQuotaQuery.refetch();
  }

  async submitLateArrival(): Promise<void> {
    if (!this.lateArrivalAvailable() || this.lateArrivalSubmitDisabled()) return;
    if (this.lateArrivalForm.invalid) {
      this.lateArrivalForm.markAllAsTouched();
      return;
    }
    const today = this.today();
    if (!today) return;
    this.lateArrivalSubmitting.set(true);
    this.lateArrivalError.set(null);
    this.lateArrivalSuccess.set(null);
    try {
      const value = this.lateArrivalForm.getRawValue();
      const input = {
        leaveDate: today.workDate,
        leaveType: 'LATE_ARRIVAL' as const,
        reason: value.reason.trim(),
      };
      const attachment = this.lateArrivalAttachment();
      if (attachment) await this.leaveRequestsService.create(input, attachment);
      else await this.leaveRequestsService.create(input);
      this.lateArrivalForm.reset({ reason: '' });
      this.lateArrivalAttachment.set(undefined);
      this.lateArrivalSuccess.set('Pengajuan izin terlambat berhasil dikirim dan menunggu keputusan SuperAdmin.');
      this.lateArrivalOpen.set(false);
      await this.lateQuotaQuery.refetch();
    } catch (error) {
      this.lateArrivalError.set(await this.apiErrorText(error, 'izin terlambat'));
    } finally {
      this.lateArrivalSubmitting.set(false);
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

  dutyLabel(duty: SecurityDuty): string {
    if (duty.status === 'DAY') return 'Shift Pagi';
    if (duty.status === 'NIGHT') return 'Shift Malam';
    if (duty.status === 'OFF') return 'Libur Rotasi';
    if (duty.status === 'UNASSIGNED') return 'Belum masuk roster';
    return 'Konfigurasi belum lengkap';
  }

  jakartaDate(timestamp: string): string {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(timestamp));
  }

  async showLocationPreview(): Promise<void> {
    if (this.actionInProgress()) return;
    try {
      await this.startLocationAcquisition(true);
    } catch (error) {
      if (this.actionInProgress()) return;
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

  private attendanceLocation(): Promise<LocationInput> {
    const cachedLocation = this.validCachedLocation();
    return cachedLocation
      ? Promise.resolve(cachedLocation)
      : this.startLocationAcquisition(false);
  }

  private startLocationAcquisition(forceRefresh: boolean): Promise<LocationInput> {
    if (this.locationAcquisition) return this.locationAcquisition;
    if (!forceRefresh) {
      const cachedLocation = this.validCachedLocation();
      if (cachedLocation) return Promise.resolve(cachedLocation);
    }

    this.clearCachedLocation();
    this.locationPreviewInProgress.set(true);
    this.locationPreviewError.set(null);
    this.permissionState.set('REQUESTING');
    this.locationAccuracyProgress.set(null);
    this.locationAcquisitionState.set('SEARCHING');

    const acquisition = this.currentLocation()
      .then((location) => {
        this.cacheReadyLocation(location);
        return location;
      })
      .catch((error: unknown) => {
        this.locationAcquisitionState.set('ERROR');
        throw error;
      })
      .finally(() => {
        if (this.locationAcquisition === acquisition) {
          this.locationAcquisition = null;
          this.locationPreviewInProgress.set(false);
        }
      });
    this.locationAcquisition = acquisition;
    return acquisition;
  }

  private validCachedLocation(): LocationInput | null {
    const cached = this.cachedAttendanceLocation;
    if (!cached) return null;
    if (Date.now() >= cached.expiresAt) {
      this.expireCachedLocation(cached);
      return null;
    }
    return cached.location;
  }

  private cacheReadyLocation(location: LocationInput): void {
    if (this.destroyed) return;
    const cached = {
      location,
      expiresAt: Date.now() + LOCATION_CACHE_TTL_MS,
    } satisfies CachedAttendanceLocation;
    this.cachedAttendanceLocation = cached;
    this.permissionState.set('GRANTED');
    this.locationPreview.set(location);
    this.locationAcquisitionState.set('READY');
    this.clearLocationExpiryTimer();
    this.locationExpiryTimer = setTimeout(
      () => this.expireCachedLocation(cached),
      LOCATION_CACHE_TTL_MS,
    );
  }

  private expireCachedLocation(cached: CachedAttendanceLocation): void {
    if (this.cachedAttendanceLocation !== cached) return;
    this.cachedAttendanceLocation = null;
    this.clearLocationExpiryTimer();
    if (this.locationAcquisitionState() === 'READY') {
      this.locationAcquisitionState.set('STALE');
    }
  }

  private clearCachedLocation(): void {
    this.cachedAttendanceLocation = null;
    this.clearLocationExpiryTimer();
  }

  private clearLocationExpiryTimer(): void {
    if (this.locationExpiryTimer === null) return;
    clearTimeout(this.locationExpiryTimer);
    this.locationExpiryTimer = null;
  }

  private async currentLocation(): Promise<LocationInput> {
    if (!this.geolocation) {
      throw new LocationRequestError('UNAVAILABLE');
    }

    try {
      return await this.requestCurrentLocation(true);
    } catch (error) {
      if (
        !(error instanceof LocationRequestError) ||
        error.permissionState !== 'DENIED' ||
        !(await this.isLocationPermissionGranted())
      ) {
        throw error;
      }

      try {
        return await this.requestCurrentLocation(false);
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
    enableHighAccuracy: boolean,
  ): Promise<LocationInput> {
    return this.acquireAttendanceLocation(enableHighAccuracy).catch((error: unknown) => {
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
      (progress) => {
        if (this.destroyed) return;
        this.locationAccuracyProgress.set(progress);
        this.locationPreview.set(progress.location);
        this.locationAcquisitionState.set('IMPROVING');
      },
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
    action: 'check-in' | 'checkout' | 'izin terlambat',
  ): Promise<string> {
    if (error instanceof HttpErrorResponse) {
      const { ApiErrorSchema } = await import('@absensi/contracts');
      const parsed = ApiErrorSchema.safeParse(error.error);
      if (parsed.success) return parsed.data.error.message;
    }
    const labels = {
      'check-in': 'Check-in',
      checkout: 'Checkout',
      'izin terlambat': 'Pengajuan izin terlambat',
    } as const;
    return `${labels[action]} belum dapat disimpan. Periksa koneksi lalu coba lagi.`;
  }
}
