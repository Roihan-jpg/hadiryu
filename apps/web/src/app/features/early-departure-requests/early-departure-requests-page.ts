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
import { GEOLOCATION } from '../attendance/geolocation';
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
        <button mat-flat-button type="submit" [disabled]="submitting()">
          {{ submitting() ? 'Mengirim…' : 'Kirim permohonan dan catat pulang' }}
        </button>
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
    mat-form-field { width: 100%; } form button { justify-self: start; }
    section[aria-labelledby] { margin-top: 2rem; } .request-list { display: grid; gap: .75rem; }
    article { border: 1px solid #d6deea; border-radius: .65rem; padding: 1rem; }
    article span { float: right; color: #315ea8; font-weight: 600; } article p { margin: .65rem 0; }
    .feedback { padding: .75rem 1rem; border-radius: .5rem; } .error { background: #fff0f0; color: #8c1d18; } .success { background: #edf8f0; color: #236b38; }
  `,
})
export class EarlyDepartureRequestsPage implements OnInit {
  private readonly service = inject(EarlyDepartureRequestsService);
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
    try {
      const location = await this.currentLocation();
      await this.service.create({
        reason: this.form.controls.reason.value.trim(),
        ...location,
      });
      this.form.reset({ reason: '' });
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

  private currentLocation(): Promise<LocationInput> {
    if (!this.geolocation) return Promise.reject(new Error('Lokasi tidak tersedia'));
    return new Promise((resolve, reject) => {
      this.geolocation!.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
        }),
        reject,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
      );
    });
  }

  private async errorText(error: unknown, fallback: string): Promise<string> {
    if (error instanceof HttpErrorResponse) {
      const { ApiErrorSchema } = await import('@absensi/contracts');
      const parsed = ApiErrorSchema.safeParse(error.error);
      if (parsed.success) return parsed.data.error.message;
    }
    return fallback;
  }
}
