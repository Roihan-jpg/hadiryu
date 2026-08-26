import type {
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { AttendanceService } from '../attendance/attendance.service';
import { GEOLOCATION } from '../attendance/geolocation';

type PermissionState =
  | 'IDLE'
  | 'REQUESTING'
  | 'GRANTED'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'TIMEOUT';

class LocationRequestError extends Error {
  constructor(readonly permissionState: Exclude<PermissionState, 'IDLE' | 'REQUESTING' | 'GRANTED'>) {
    super(permissionState);
  }
}

@Component({
  imports: [MatButtonModule, MatProgressSpinnerModule, RouterLink],
  selector: 'app-home-page',
  styleUrl: './home-page.scss',
  templateUrl: './home-page.html',
})
export class HomePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly roleLabel = computed(() =>
    this.user()?.role === 'SUPER_ADMIN' ? 'SuperAdmin' : 'Guru',
  );
  readonly today = signal<TodayAttendanceResponse | null>(null);
  readonly loadingToday = signal(false);
  readonly actionInProgress = signal(false);
  readonly permissionState = signal<PermissionState>('IDLE');
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly workDateLabel = computed(() => {
    const workDate = this.today()?.workDate;
    if (!workDate) return '';
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  });

  ngOnInit(): void {
    if (this.user()?.role === 'USER') void this.loadToday();
  }

  async loadToday(): Promise<void> {
    if (this.loadingToday()) return;
    this.loadingToday.set(true);
    this.errorMessage.set(null);
    try {
      this.today.set(await this.attendanceService.getToday());
    } catch {
      this.errorMessage.set(
        'Status absensi hari ini tidak dapat dimuat. Periksa koneksi lalu coba lagi.',
      );
    } finally {
      this.loadingToday.set(false);
    }
  }

  async checkIn(): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(true);
    this.permissionState.set('REQUESTING');
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const location = await this.currentLocation();
      this.permissionState.set('GRANTED');
      const attendance = await this.attendanceService.checkIn(location);
      this.today.set({
        serverNow: attendance.checkInAt,
        workDate: attendance.workDate,
        state: 'CHECKED_IN',
        schedule: this.today()?.schedule ?? null,
        attendance,
      });
      this.successMessage.set(
        `Check-in berhasil dicatat pukul ${this.jakartaTime(attendance.checkInAt)}.`,
      );
    } catch (error) {
      if (error instanceof LocationRequestError) {
        this.permissionState.set(error.permissionState);
        this.errorMessage.set(this.locationErrorText(error.permissionState));
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
    this.permissionState.set('REQUESTING');
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const location = await this.currentLocation();
      this.permissionState.set('GRANTED');
      const attendance = await this.attendanceService.checkout(location);
      this.today.set({
        serverNow: attendance.checkOutAt,
        workDate: attendance.workDate,
        state: 'COMPLETED',
        schedule: this.today()?.schedule ?? null,
        attendance,
      });
      this.successMessage.set(
        `Checkout berhasil dicatat pukul ${this.jakartaTime(attendance.checkOutAt)}.`,
      );
    } catch (error) {
      if (error instanceof LocationRequestError) {
        this.permissionState.set(error.permissionState);
        this.errorMessage.set(this.locationErrorText(error.permissionState));
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

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private currentLocation(): Promise<LocationInput> {
    if (!this.geolocation) {
      return Promise.reject(new LocationRequestError('UNAVAILABLE'));
    }
    return new Promise((resolve, reject) => {
      this.geolocation!.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          });
        },
        (error) => {
          reject(
            new LocationRequestError(
              error.code === 1
                ? 'DENIED'
                : error.code === 3
                  ? 'TIMEOUT'
                  : 'UNAVAILABLE',
            ),
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  }

  private locationErrorText(state: PermissionState): string {
    if (state === 'DENIED') {
      return 'Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu coba lagi.';
    }
    if (state === 'TIMEOUT') {
      return 'Lokasi belum ditemukan. Berpindah ke area terbuka lalu coba lagi.';
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
