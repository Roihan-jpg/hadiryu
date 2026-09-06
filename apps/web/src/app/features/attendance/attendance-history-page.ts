import type { AttendanceRecord } from '@absensi/contracts';
import { Component, computed, ElementRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AttendanceService } from './attendance.service';
import { queryKeys } from '../../core/query/query-keys';
import { createIndonesianPaginatorIntl } from '../../core/ui/paginator-intl';

function currentJakartaMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

@Component({
  imports: [
    MatButtonModule,
    MatPaginatorModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-attendance-history-page',
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  styleUrl: './attendance-history-page.scss',
  templateUrl: './attendance-history-page.html',
})
export class AttendanceHistoryPage {
  private readonly service = inject(AttendanceService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly monthControl = new FormControl(currentJakartaMonth(), {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{4}-(?:0[1-9]|1[0-2])$/)],
  });
  readonly filters = signal({
    page: 1,
    pageSize: 10,
    month: this.monthControl.value,
  });
  readonly historyQuery = injectQuery(() => ({
    queryKey: queryKeys.attendance('history', this.filters()),
    queryFn: () => this.service.fetchHistory(this.filters()),
  }));
  readonly records = computed<AttendanceRecord[]>(() => this.historyQuery.data()?.data ?? []);
  readonly loading = computed(() => this.historyQuery.isPending());
  readonly errorMessage = computed(() => this.historyQuery.isError()
    ? 'Riwayat absensi tidak dapat dimuat. Periksa koneksi lalu coba lagi.'
    : '');
  readonly pagination = computed(() => this.historyQuery.data()?.pagination ?? ({
    page: this.filters().page,
    pageSize: this.filters().pageSize,
    totalItems: 0,
    totalPages: 0,
  }));

  loadHistory(): void {
    if (this.monthControl.invalid) {
      this.monthControl.markAsTouched();
      this.focusMonthField();
      return;
    }
    void this.historyQuery.refetch();
  }

  applyMonth(): void {
    if (this.monthControl.invalid) {
      this.monthControl.markAsTouched();
      this.focusMonthField();
      return;
    }
    this.filters.update((value) => ({
      ...value,
      month: this.monthControl.value,
      page: 1,
    }));
  }

  pageChanged(event: PageEvent): void {
    this.filters.update((value) => ({
      ...value,
      page: event.pageIndex + 1,
      pageSize: event.pageSize,
    }));
  }

  dateLabel(workDate: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  }

  jakartaTime(timestamp: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(timestamp));
  }

  statusLabel(record: AttendanceRecord): string {
    if (record.status === 'COMPLETED') return 'Selesai';
    if (record.status === 'INCOMPLETE') return 'Tidak lengkap';
    return 'Sedang berlangsung';
  }

  private focusMonthField(): void {
    this.host.nativeElement.querySelector<HTMLInputElement>('#history-month')?.focus();
  }
}
