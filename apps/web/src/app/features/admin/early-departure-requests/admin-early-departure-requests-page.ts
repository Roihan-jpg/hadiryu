import type {
  AdminEarlyDepartureRequest,
  EarlyDepartureStatus,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { EarlyDepartureRequestsService } from '../../early-departure-requests/early-departure-requests.service';

type StatusFilter = EarlyDepartureStatus | 'ALL';

@Component({
  imports: [MatButtonModule, MatProgressSpinnerModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  selector: 'app-admin-early-departure-requests-page',
  template: `
    <section class="page-shell">
      <a routerLink="/admin">← Kembali ke monitoring</a>
      <header><p>Keputusan admin</p><h1>Approval pulang awal</h1></header>
      <mat-form-field appearance="outline">
        <mat-label>Status</mat-label>
        <mat-select [formControl]="statusControl" (selectionChange)="load()">
          <mat-option value="PENDING">Pending</mat-option>
          <mat-option value="APPROVED">Disetujui</mat-option>
          <mat-option value="REJECTED">Ditolak</mat-option>
          <mat-option value="ALL">Semua</mat-option>
        </mat-select>
      </mat-form-field>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (successMessage()) { <p class="feedback success" role="status">{{ successMessage() }}</p> }
      @if (loading()) { <mat-spinner diameter="28" /> }
      @else if (requests().length === 0) { <p>Belum ada permohonan pada filter ini.</p> }
      @else {
        <div class="request-list">
          @for (request of requests(); track request.id) {
            <article>
              <div><strong>{{ request.teacherFullName }}</strong><span>{{ request.teacherNip }}</span></div>
              <p>{{ dateTimeLabel(request.requestedAt) }} · {{ statusLabel(request.status) }}</p>
              <p>{{ request.reason }}</p>
              @if (request.status === 'PENDING') {
                <div class="actions">
                  <button mat-flat-button type="button" (click)="decide(request, 'APPROVED')" [disabled]="actionInProgress() !== null">Setujui</button>
                  <button mat-button type="button" (click)="decide(request, 'REJECTED')" [disabled]="actionInProgress() !== null">Tolak</button>
                </div>
              }
            </article>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .page-shell { width: min(100% - 2rem, 64rem); margin: 0 auto; padding: 2rem 0 4rem; }
    header { margin: 1.5rem 0; } header p { color: #315ea8; font-weight: 700; } h1, p { margin-top: 0; }
    .request-list { display: grid; gap: .75rem; } article { padding: 1rem; border: 1px solid #d6deea; border-radius: .65rem; }
    article div:first-child { display: flex; justify-content: space-between; gap: 1rem; } article span { color: #56677e; }
    .actions { display: flex; gap: .5rem; } .feedback { padding: .75rem 1rem; border-radius: .5rem; }
    .error { background: #fff0f0; color: #8c1d18; } .success { background: #edf8f0; color: #236b38; }
  `,
})
export class AdminEarlyDepartureRequestsPage implements OnInit {
  private readonly service = inject(EarlyDepartureRequestsService);
  readonly statusControl = new FormControl<StatusFilter>('PENDING', { nonNullable: true });
  readonly requests = signal<AdminEarlyDepartureRequest[]>([]);
  readonly loading = signal(true);
  readonly actionInProgress = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const result = await this.service.listAdmin({
        page: 1,
        pageSize: 100,
        ...(this.statusControl.value === 'ALL' ? {} : { status: this.statusControl.value }),
      });
      this.requests.set(result.data);
    } catch (error) {
      this.errorMessage.set(await this.errorText(error, 'Daftar pulang awal tidak dapat dimuat.'));
    } finally { this.loading.set(false); }
  }

  async decide(request: AdminEarlyDepartureRequest, action: 'APPROVED' | 'REJECTED'): Promise<void> {
    if (request.status !== 'PENDING' || this.actionInProgress()) return;
    const accepted = window.confirm(action === 'APPROVED' ? 'Setujui permohonan pulang awal ini?' : 'Tolak permohonan pulang awal ini?');
    if (!accepted) return;
    this.actionInProgress.set(request.id);
    this.errorMessage.set('');
    try {
      await this.service.decide(request.id, action);
      this.successMessage.set(action === 'APPROVED' ? 'Pulang awal disetujui.' : 'Pulang awal ditolak.');
      await this.load();
    } catch (error) {
      this.errorMessage.set(await this.errorText(error, 'Keputusan tidak dapat disimpan.'));
    } finally { this.actionInProgress.set(null); }
  }

  statusLabel(status: EarlyDepartureStatus): string {
    return ({ PENDING: 'Pending', APPROVED: 'Disetujui', REJECTED: 'Ditolak' })[status];
  }

  dateTimeLabel(value: string): string {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value));
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
