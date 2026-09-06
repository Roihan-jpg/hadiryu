import type { LeaveRequest, LeaveStatus, LeaveType } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators, type ValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AttendanceService } from '../attendance/attendance.service';
import { queryKeys } from '../../core/query/query-keys';
import { LeaveRequestsService } from './leave-requests.service';
import { focusFirstInvalidControl } from '../../core/ui/form-focus';
import { createIndonesianPaginatorIntl } from '../../core/ui/paginator-intl';

function todayJakarta(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const find = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${find('year')}-${find('month')}-${find('day')}`;
}

function dateNotBefore(minimumDate: string): ValidatorFn {
  return (control) =>
    typeof control.value === 'string' && control.value !== '' && control.value < minimumDate
      ? { pastDate: true }
      : null;
}

@Component({
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  selector: 'app-leave-requests-page', styleUrl: './leave-requests-page.scss', templateUrl: './leave-requests-page.html',
})
export class LeaveRequestsPage {
  private readonly service = inject(LeaveRequestsService);
  private readonly attendanceService = inject(AttendanceService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly minDate = todayJakarta();
  readonly form = new FormGroup({
    leaveDate: new FormControl(this.minDate, { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/), dateNotBefore(this.minDate)] }),
    leaveType: new FormControl<LeaveType>('SICK', { nonNullable: true, validators: [Validators.required] }),
    reason: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(1000)] }),
  });
  readonly selectedLeaveDate = toSignal(this.form.controls.leaveDate.valueChanges, {
    initialValue: this.form.controls.leaveDate.value,
  });
  readonly actionInProgress = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly attachment = signal<File | undefined>(undefined);
  readonly requestFilters = signal({ page: 1, pageSize: 10 });
  readonly requestsQuery = injectQuery(() => ({
    queryKey: queryKeys.leaveRequests('own', this.requestFilters()),
    queryFn: () => this.service.fetchOwn(this.requestFilters()),
  }));
  readonly todayQuery = injectQuery(() => ({
    queryKey: queryKeys.attendance('today'),
    queryFn: () => this.attendanceService.fetchToday(),
  }));
  readonly requests = computed<LeaveRequest[]>(() => this.requestsQuery.data()?.data ?? []);
  readonly loading = computed(() => this.requestsQuery.isPending());
  readonly pagination = computed(() => this.requestsQuery.data()?.pagination ?? ({
    page: this.requestFilters().page,
    pageSize: this.requestFilters().pageSize,
    totalItems: 0,
    totalPages: 0,
  }));
  readonly isTodayLeaveBlocked = computed(() => {
    const today = this.todayQuery.data();
    return today?.workDate === this.selectedLeaveDate() &&
      (today.state === 'CHECKED_IN' || today.state === 'COMPLETED' || today.state === 'INCOMPLETE');
  });
  readonly submitDisabled = computed(() =>
    this.actionInProgress() !== null || this.todayQuery.isPending() || this.isTodayLeaveBlocked(),
  );
  readonly leaveBlockMessage = computed(() => this.isTodayLeaveBlocked()
    ? 'Izin untuk hari ini tidak dapat diajukan karena absensi check-in sudah tercatat.'
    : '');
  readonly displayErrorMessage = computed(() => this.errorMessage() || (this.requestsQuery.isError()
    ? 'Daftar izin tidak dapat dimuat. Periksa koneksi lalu coba lagi.'
    : ''));

  load(): void { void this.requestsQuery.refetch(); }

  async submit(): Promise<void> {
    if (this.submitDisabled()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); focusFirstInvalidControl(this.host.nativeElement); return; }
    this.actionInProgress.set('create'); this.errorMessage.set(''); this.successMessage.set('');
    try {
      const value = this.form.getRawValue();
      const input = { leaveDate: value.leaveDate, leaveType: value.leaveType, reason: value.reason.trim() };
      const attachment = this.attachment();
      if (attachment) await this.service.create(input, attachment);
      else await this.service.create(input);
      this.successMessage.set('Pengajuan izin berhasil dikirim dan menunggu keputusan SuperAdmin.');
      this.form.controls.reason.setValue('');
      this.attachment.set(undefined);
      this.requestFilters.update((page) => ({ ...page, page: 1 }));
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Pengajuan izin tidak dapat dikirim.')); }
    finally { this.actionInProgress.set(null); }
  }

  attachmentChanged(event: Event): void {
    this.attachment.set((event.target as HTMLInputElement).files?.[0]);
  }

  async cancel(request: LeaveRequest): Promise<void> {
    if (request.status !== 'PENDING' || this.actionInProgress()) return;
    this.actionInProgress.set(request.id); this.errorMessage.set(''); this.successMessage.set('');
    try {
      await this.service.cancel(request.id);
      this.successMessage.set('Pengajuan izin berhasil dibatalkan.');
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Izin tidak dapat dibatalkan.')); }
    finally { this.actionInProgress.set(null); }
  }

  pageChanged(event: PageEvent): void {
    this.requestFilters.update((page) => ({ ...page, page: event.pageIndex + 1, pageSize: event.pageSize }));
  }

  typeLabel(type: LeaveType): string { return ({ SICK: 'Sakit', OFFICIAL_DUTY: 'Dinas Luar', FAMILY: 'Kepentingan Keluarga', OTHER: 'Lainnya' })[type]; }
  statusLabel(status: LeaveStatus): string { return ({ PENDING: 'Menunggu keputusan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' })[status]; }
  dateLabel(workDate: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
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
