import type { LeaveRequest, LeaveStatus, LeaveType } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { LeaveRequestsService } from './leave-requests.service';

function todayJakarta(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const find = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${find('year')}-${find('month')}-${find('day')}`;
}

@Component({
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatProgressSpinnerModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  selector: 'app-leave-requests-page', styleUrl: './leave-requests-page.scss', templateUrl: './leave-requests-page.html',
})
export class LeaveRequestsPage implements OnInit {
  private readonly service = inject(LeaveRequestsService);
  readonly minDate = todayJakarta();
  readonly form = new FormGroup({
    leaveDate: new FormControl(this.minDate, { nonNullable: true, validators: [Validators.required] }),
    leaveType: new FormControl<LeaveType>('SICK', { nonNullable: true, validators: [Validators.required] }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)] }),
  });
  readonly requests = signal<LeaveRequest[]>([]);
  readonly loading = signal(true);
  readonly actionInProgress = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly pagination = signal({ page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true); this.errorMessage.set('');
    try {
      const page = this.pagination();
      const result = await this.service.listOwn({ page: page.page, pageSize: page.pageSize });
      this.requests.set(result.data); this.pagination.set(result.pagination);
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Daftar izin tidak dapat dimuat.')); }
    finally { this.loading.set(false); }
  }

  async submit(): Promise<void> {
    if (this.actionInProgress()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.actionInProgress.set('create'); this.errorMessage.set(''); this.successMessage.set('');
    try {
      const value = this.form.getRawValue();
      await this.service.create({ leaveDate: value.leaveDate, leaveType: value.leaveType, reason: value.reason.trim() });
      this.successMessage.set('Pengajuan izin berhasil dikirim dan menunggu keputusan SuperAdmin.');
      this.form.controls.reason.setValue('');
      this.pagination.update((page) => ({ ...page, page: 1 }));
      await this.load();
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Pengajuan izin tidak dapat dikirim.')); }
    finally { this.actionInProgress.set(null); }
  }

  async cancel(request: LeaveRequest): Promise<void> {
    if (request.status !== 'PENDING' || this.actionInProgress()) return;
    this.actionInProgress.set(request.id); this.errorMessage.set(''); this.successMessage.set('');
    try {
      await this.service.cancel(request.id);
      this.successMessage.set('Pengajuan izin berhasil dibatalkan.');
      await this.load();
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Izin tidak dapat dibatalkan.')); }
    finally { this.actionInProgress.set(null); }
  }

  async pageChanged(event: PageEvent): Promise<void> {
    this.pagination.update((page) => ({ ...page, page: event.pageIndex + 1, pageSize: event.pageSize }));
    await this.load();
  }

  typeLabel(type: LeaveType): string { return ({ SICK: 'Sakit', OFFICIAL_DUTY: 'Dinas Luar', FAMILY: 'Kepentingan Keluarga', OTHER: 'Lainnya' })[type]; }
  statusLabel(status: LeaveStatus): string { return ({ PENDING: 'Menunggu keputusan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' })[status]; }

  private async errorText(error: unknown, fallback: string): Promise<string> {
    if (error instanceof HttpErrorResponse) {
      const { ApiErrorSchema } = await import('@absensi/contracts');
      const parsed = ApiErrorSchema.safeParse(error.error);
      if (parsed.success) return parsed.data.error.message;
    }
    return fallback;
  }
}
