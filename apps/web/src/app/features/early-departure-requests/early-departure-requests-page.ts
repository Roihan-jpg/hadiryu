import type {
  EarlyDepartureRequest,
  EarlyDepartureStatus,
  LocationInput,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { focusFirstInvalidControl } from '../../core/ui/form-focus';
import { queryKeys } from '../../core/query/query-keys';
import { AttendanceService } from '../attendance/attendance.service';
import {
  acquirePreciseLocation,
  GEOLOCATION,
  PreciseLocationError,
  type LocationAccuracyProgress,
} from '../attendance/geolocation';
import { EarlyDepartureRequestsService } from './early-departure-requests.service';
import { RequestQuotasService } from '../request-quotas.service';

function currentJakartaMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
}

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-early-departure-requests-page',
  templateUrl: './early-departure-requests-page.html',
  styleUrl: './early-departure-requests-page.scss',
})
export class EarlyDepartureRequestsPage {
  private readonly service = inject(EarlyDepartureRequestsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly quotaService = inject(RequestQuotasService);
  readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)],
    }),
  });
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly attachment = signal<File | undefined>(undefined);
  readonly locationProgress = signal<LocationAccuracyProgress | null>(null);
  readonly locationMaxAccuracyMeters = signal(15);
  readonly requestsQuery = injectQuery(() => ({
    queryKey: queryKeys.earlyDepartureRequests('own', { page: 1, pageSize: 20 }),
    queryFn: () => this.service.fetchOwn({ page: 1, pageSize: 20 }),
  }));
  readonly todayQuery = injectQuery(() => ({
    queryKey: queryKeys.attendance('today'),
    queryFn: () => this.attendanceService.fetchToday(),
  }));
  readonly quotaMonth = computed(() => this.todayQuery.data()?.workDate.slice(0, 7) ?? currentJakartaMonth());
  readonly quotaQuery = injectQuery(() => ({
    queryKey: queryKeys.requestQuotas(this.quotaMonth()),
    queryFn: () => this.quotaService.fetch(this.quotaMonth()),
  }));
  readonly requests = computed<EarlyDepartureRequest[]>(() => this.requestsQuery.data()?.data ?? []);
  readonly loading = computed(() => this.requestsQuery.isPending());
  readonly submissionDisabled = computed(() =>
    this.submitting() || this.todayQuery.isPending() || this.todayQuery.data()?.state !== 'CHECKED_IN' ||
    this.todayQuery.data()?.operationalBlock?.blockedActions.includes('EARLY_DEPARTURE') ||
    this.quotaQuery.data()?.earlyDeparture.remaining === 0,
  );
  readonly submissionHelp = computed(() => {
    const state = this.todayQuery.data()?.state;
    if (this.todayQuery.isPending()) return 'Memeriksa status absensi hari ini…';
    if (this.todayQuery.data()?.operationalBlock?.blockedActions.includes('EARLY_DEPARTURE')) return 'Pulang awal ditutup selama izin aktif.';
    if (this.quotaQuery.data()?.earlyDeparture.remaining === 0) return 'Kuota pulang awal bulan ini sudah habis (maksimal 2 kali).';
    if (state === 'CHECKED_IN') return '';
    if (state === 'COMPLETED') return 'Absen Pulang sudah tercatat. Permohonan pulang awal tidak dapat dikirim.';
    if (state === 'READY_TO_CHECK_IN') return 'Lakukan Absen Masuk terlebih dahulu sebelum mengajukan pulang awal.';
    return 'Permohonan pulang awal tidak tersedia untuk status absensi hari ini.';
  });
  readonly displayErrorMessage = computed(() => this.errorMessage() || (this.requestsQuery.isError()
    ? 'Daftar pulang awal tidak dapat dimuat. Periksa koneksi lalu coba lagi.'
    : ''));

  load(): void { void this.requestsQuery.refetch(); }

  retryQuota(): void { void this.quotaQuery.refetch(); }

  async submit(): Promise<void> {
    if (this.submissionDisabled()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');
    this.locationProgress.set(null);
    try {
      const location = await this.currentLocation();
      const input = {
        reason: this.form.controls.reason.value.trim(),
        ...location,
      };
      const attachment = this.attachment();
      if (attachment) await this.service.create(input, attachment);
      else await this.service.create(input);
      this.form.reset({ reason: '' });
      this.attachment.set(undefined);
      this.successMessage.set('Permohonan terkirim. Absensi pulang dicatat dan menunggu keputusan admin.');
      void this.quotaQuery.refetch();
    } catch (error) {
      this.errorMessage.set(await this.errorText(error, 'Permohonan pulang awal tidak dapat dikirim.'));
    } finally { this.submitting.set(false); }
  }

  statusLabel(status: EarlyDepartureStatus): string {
    return ({ PENDING: 'Menunggu keputusan admin', APPROVED: 'Disetujui', REJECTED: 'Ditolak' })[status];
  }

  dateTimeLabel(value: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
    }).format(new Date(value));
  }

  rounded(value: number): number { return Math.round(value); }

  attachmentChanged(event: Event): void { this.attachment.set((event.target as HTMLInputElement).files?.[0]); }

  private async currentLocation(): Promise<LocationInput> {
    if (!this.geolocation) return Promise.reject(new Error('Lokasi tidak tersedia'));
    const today = this.todayQuery.data();
    if (!today) return Promise.reject(new Error('Status absensi belum tersedia'));
    const maxAccuracyMeters = today.locationRequirement?.maxAccuracyMeters ?? 15;
    this.locationMaxAccuracyMeters.set(maxAccuracyMeters);
    return acquirePreciseLocation(
      this.geolocation,
      maxAccuracyMeters,
      (progress) => this.locationProgress.set(progress),
    );
  }

  private async errorText(error: unknown, fallback: string): Promise<string> {
    if (error instanceof PreciseLocationError) {
      if (error.state === 'INACCURATE' && error.bestAccuracyMeters !== undefined) {
        return `Akurasi terbaik ${Math.round(error.bestAccuracyMeters)} meter belum memenuhi batas ${this.locationMaxAccuracyMeters()} meter. Bergerak ke tengah halaman lalu coba lagi.`;
      }
      if (error.state === 'DENIED') return 'Aktifkan izin lokasi untuk situs ini lalu coba lagi.';
      return 'Lokasi presisi belum ditemukan. Bergerak ke halaman terbuka lalu coba lagi.';
    }
    if (error instanceof HttpErrorResponse) {
      const { ApiErrorSchema } = await import('@absensi/contracts');
      const parsed = ApiErrorSchema.safeParse(error.error);
      if (parsed.success) return parsed.data.error.message;
    }
    return fallback;
  }
}
