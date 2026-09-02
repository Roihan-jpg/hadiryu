import type { AttendanceRecord } from '@absensi/contracts';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';

import { AttendanceService } from './attendance.service';
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
    MatProgressSpinnerModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-attendance-history-page',
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  styleUrl: './attendance-history-page.scss',
  templateUrl: './attendance-history-page.html',
})
export class AttendanceHistoryPage implements OnInit {
  private readonly service = inject(AttendanceService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly monthControl = new FormControl(currentJakartaMonth(), {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{4}-(?:0[1-9]|1[0-2])$/)],
  });
  readonly records = signal<AttendanceRecord[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly pagination = signal({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
  });

  ngOnInit(): void {
    void this.loadHistory();
  }

  async loadHistory(): Promise<void> {
    if (this.monthControl.invalid) {
      this.monthControl.markAsTouched();
      this.focusMonthField();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const page = this.pagination();
      const result = await this.service.getHistory({
        page: page.page,
        pageSize: page.pageSize,
        month: this.monthControl.value,
      });
      this.records.set(result.data);
      this.pagination.set(result.pagination);
    } catch {
      this.errorMessage.set(
        'Riwayat absensi tidak dapat dimuat. Periksa koneksi lalu coba lagi.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async applyMonth(): Promise<void> {
    if (this.monthControl.invalid) {
      this.monthControl.markAsTouched();
      this.focusMonthField();
      return;
    }
    this.pagination.update((value) => ({ ...value, page: 1 }));
    await this.loadHistory();
  }

  async pageChanged(event: PageEvent): Promise<void> {
    this.pagination.update((value) => ({
      ...value,
      page: event.pageIndex + 1,
      pageSize: event.pageSize,
    }));
    await this.loadHistory();
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
