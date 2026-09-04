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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-early-departure-requests-page',
  template: `
    <section class="page-shell">
      <a routerLink="/guru">← Kembali ke hari ini</a>
      <header>
        <p>Permohonan hari ini</p>
        <h1>Pulang awal</h1>
        <p>Waktu dan lokasi keberangkatan dicatat server saat permohonan dikirim.</p>
      </header>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (successMessage()) { <p class="feedback success" role="status">{{ successMessage() }}</p> }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-form-field appearance="outline">
          <mat-label>Alasan pulang awal</mat-label>
          <textarea matInput rows="4" maxlength="1000" formControlName="reason"></textarea>
          <mat-error>Alasan wajib diisi, maksimal 1.000 karakter.</mat-error>
        </mat-form-field>
        <label class="attachment-field">Lampiran opsional (PDF/JPEG/PNG, maks. 5 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" (change)="attachmentChanged($event)" /></label>
        <button mat-flat-button type="submit" [disabled]="submitting()">
          {{ submitting() ? 'Mengirim…' : 'Kirim permohonan dan catat pulang' }}
        </button>
        @if (submitting() && locationProgress(); as progress) {
          <small aria-live="polite">Akurasi terbaik {{ rounded(progress.bestAccuracyMeters) }} meter · syarat maksimal {{ progress.maxAccuracyMeters }} meter</small>
        }
      </form>
      <section aria-labelledby="history-title">
        <h2 id="history-title">Riwayat permohonan</h2>
        @if (loading()) {
          <mat-spinner diameter="28" aria-label="Memuat permohonan" />
        } @else if (requests().length === 0) {
          <p>Belum ada permohonan pulang awal.</p>
        } @else {
          <div class="request-list">
            @for (request of requests(); track request.id) {
              <article>
                <strong>{{ dateTimeLabel(request.requestedAt) }}</strong>
                <span>{{ statusLabel(request.status) }}</span>
                <p>{{ request.reason }}</p>
                @if (request.attachment) { <a [href]="'/api/early-departure-requests/' + request.id + '/attachment'">Unduh lampiran: {{ request.attachment.originalName }}</a> }
                @if (request.decisionNote) { <small>Catatan admin: {{ request.decisionNote }}</small> }
              </article>
            }
          </div>
        }
      </section>
    </section>
  `,
  styles: `
    .page-shell { width: min(100% - 2rem, 54rem); margin: 0 auto; padding: 2rem 0 4rem; }
    header { margin: 1.5rem 0; } header p:first-child { color: #315ea8; font-weight: 700; }
    h1, h2, p { margin-top: 0; } form { display: grid; gap: .75rem; padding: 1.25rem; border: 1px solid #ccd6e4; border-radius: .75rem; }
    mat-form-field { width: 100%; } form button { justify-self: start; } .attachment-field { display: grid; gap: .4rem; color: #58677d; font-size: .82rem; } .attachment-field input { padding: .65rem; border: 1px dashed #aeb9c8; border-radius: .45rem; }
    section[aria-labelledby] { margin-top: 2rem; } .request-list { display: grid; gap: .75rem; }
    article { border: 1px solid #d6deea; border-radius: .65rem; padding: 1rem; }
    article span { float: right; color: #315ea8; font-weight: 600; } article p { margin: .65rem 0; }
    .feedback { padding: .75rem 1rem; border-radius: .5rem; } .error { background: #fff0f0; color: #8c1d18; } .success { background: #edf8f0; color: #236b38; }
  `,
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
