import type {
  EarlyDepartureRequest,
  EarlyDepartureStatus,
  LocationInput,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';

import { focusFirstInvalidControl } from '../../core/ui/form-focus';
import { AttendanceService } from '../attendance/attendance.service';
import {
  acquirePreciseLocation,
  GEOLOCATION,
  PreciseLocationError,
  type LocationAccuracyProgress,
} from '../attendance/geolocation';
import { EarlyDepartureRequestsService } from './early-departure-requests.service';

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-early-departure-requests-page',
  templateUrl: './early-departure-requests-page.html',
  styleUrl: './early-departure-requests-page.scss',
})
export class EarlyDepartureRequestsPage implements OnInit {
  private readonly service = inject(EarlyDepartureRequestsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly geolocation = inject(GEOLOCATION);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)],
    }),
  });
  readonly requests = signal<EarlyDepartureRequest[]>([]);
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly attachment = signal<File | undefined>(undefined);
  readonly locationProgress = signal<LocationAccuracyProgress | null>(null);
  readonly locationMaxAccuracyMeters = signal(15);

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await this.service.listOwn({ page: 1, pageSize: 20 });
      this.requests.set(result.data);
    } catch (error) {
      this.errorMessage.set(await this.errorText(error, 'Daftar pulang awal tidak dapat dimuat.'));
    } finally { this.loading.set(false); }
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
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
      await this.load();
    } catch (error) {
      this.errorMessage.set(await this.errorText(error, 'Permohonan pulang awal tidak dapat dikirim.'));
    } finally { this.submitting.set(false); }
  }

  statusLabel(status: EarlyDepartureStatus): string {
    return ({ PENDING: 'Pending', APPROVED: 'Disetujui', REJECTED: 'Ditolak' })[status];
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
    const today = await this.attendanceService.getToday();
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
