import type {
  AdminAttendanceRecord,
  AdminAttendanceStatus,
  AdminAttendanceSummary,
  CreateAttendanceAdminNote,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorIntl,
  MatPaginatorModule,
  type PageEvent,
} from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { focusFirstInvalidControl } from '../../../core/ui/form-focus';
import { createIndonesianPaginatorIntl } from '../../../core/ui/paginator-intl';
import { AdminDashboardService } from './admin-dashboard.service';

type StatusFilter = AdminAttendanceStatus | 'ALL';

@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Tambah catatan</h2>
    <mat-dialog-content>
      <p>Catatan untuk <strong>{{ data.teacherFullName }}</strong> bersifat permanen dan tidak mengubah hasil absensi.</p>
      <mat-form-field appearance="outline">
        <mat-label>Catatan administratif</mat-label>
        <textarea matInput rows="4" maxlength="2000" name="attendanceNote" autocomplete="off" [formControl]="noteControl"></textarea>
        @if (noteControl.invalid && noteControl.touched) {
          <mat-error>Catatan wajib diisi dan maksimal 2.000 karakter.</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="undefined">Batal</button>
      <button mat-flat-button type="button" (click)="submit()">Simpan catatan</button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { width: min(34rem, 72vw); }
    mat-dialog-content p { color: #58677d; line-height: 1.55; }
    mat-form-field { width: 100%; margin-top: .5rem; }
    @media (max-width: 520px) { mat-dialog-content { width: auto; } }
  `,
})
export class AttendanceNoteDialog {
  readonly data = inject<Pick<AdminAttendanceRecord, 'teacherFullName'>>(
    MAT_DIALOG_DATA,
  );
  readonly noteControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(2000)],
  });
  private readonly dialogRef = inject(MatDialogRef<AttendanceNoteDialog>);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  submit(): void {
    const note = this.noteControl.value.trim();
    if (!note || this.noteControl.invalid) {
      this.noteControl.markAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    this.dialogRef.close({ note } satisfies CreateAttendanceAdminNote);
  }
}

@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    FormsModule,
    ReactiveFormsModule,
  ],
  selector: 'app-admin-dashboard-page',
  providers: [
    {
      provide: MatPaginatorIntl,
      useFactory: createIndonesianPaginatorIntl,
    },
  ],
  styleUrl: './admin-dashboard-page.scss',
  templateUrl: './admin-dashboard-page.html',
})
export class AdminDashboardPage implements OnInit {
  private readonly service = inject(AdminDashboardService);
  private readonly dialog = inject(MatDialog);

  readonly dateControl = new FormControl('', { nonNullable: true });
  readonly statusControl = new FormControl<StatusFilter>('ALL', {
    nonNullable: true,
  });
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly summary = signal<AdminAttendanceSummary | null>(null);
  readonly records = signal<AdminAttendanceRecord[]>([]);
  readonly pagination = signal({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  readonly loading = signal(true);
  readonly noteInProgress = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const pagination = this.pagination();
      const workDate = this.dateControl.value;
      const search = this.searchControl.value.trim();
      const result = await this.service.list({
        page: pagination.page,
        pageSize: pagination.pageSize,
        ...(workDate ? { workDate } : {}),
        ...(this.statusControl.value === 'ALL'
          ? {}
          : { status: this.statusControl.value }),
        ...(search ? { search } : {}),
      });
      this.summary.set(result.summary);
      this.records.set(result.data);
      this.pagination.set(result.pagination);
      if (!this.dateControl.value) {
        this.dateControl.setValue(result.summary.workDate, { emitEvent: false });
      }
    } catch (error) {
      this.errorMessage.set(
        await this.errorText(
          error,
          'Monitoring kehadiran tidak dapat dimuat. Periksa koneksi lalu coba lagi.',
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async applyFilters(): Promise<void> {
    if (this.loading()) return;
    this.pagination.update((value) => ({ ...value, page: 1 }));
    await this.load();
  }

  async filterStatus(status: AdminAttendanceStatus): Promise<void> {
    if (this.loading()) return;
    this.statusControl.setValue(status);
    await this.applyFilters();
  }

  async pageChanged(event: PageEvent): Promise<void> {
    if (this.loading()) return;
    this.pagination.update((value) => ({
      ...value,
      page: event.pageIndex + 1,
      pageSize: event.pageSize,
    }));
    await this.load();
  }

  openNote(record: AdminAttendanceRecord): void {
    if (!record.attendanceId || this.noteInProgress()) return;
    const reference = this.dialog.open(AttendanceNoteDialog, {
      data: { teacherFullName: record.teacherFullName },
      width: 'min(28rem, 100vw)',
      maxWidth: '100vw',
      height: '100dvh',
      position: { right: '0', top: '0' },
      panelClass: 'admin-side-sheet',
    });
    reference
      .afterClosed()
      .subscribe((input: CreateAttendanceAdminNote | undefined) => {
        if (input) void this.saveNote(record, input);
      });
  }

  async saveNote(
    record: AdminAttendanceRecord,
    input: CreateAttendanceAdminNote,
  ): Promise<void> {
    if (!record.attendanceId || this.noteInProgress()) return;
    this.noteInProgress.set(record.attendanceId);
    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      const note = await this.service.addNote(record.attendanceId, input);
      this.records.update((records) =>
        records.map((candidate) =>
          candidate.attendanceId === record.attendanceId
            ? { ...candidate, notes: [...candidate.notes, note] }
            : candidate,
        ),
      );
      this.successMessage.set('Catatan admin berhasil ditambahkan.');
    } catch (error) {
      this.errorMessage.set(
        await this.errorText(error, 'Catatan admin tidak dapat disimpan.'),
      );
    } finally {
      this.noteInProgress.set(null);
    }
  }

  statusLabel(status: AdminAttendanceStatus): string {
    return {
      PRESENT: 'Hadir',
      LATE: 'Terlambat',
      NOT_PRESENT: 'Belum hadir',
      INCOMPLETE: 'Tidak lengkap',
      LEAVE: 'Izin',
      OFF: 'Libur rotasi',
    }[status];
  }

  statusDetail(record: AdminAttendanceRecord): string {
    if (record.status === 'LATE') {
      return `${record.arrivalLateMinutes ?? 0} menit terlambat`;
    }
    if (record.status === 'INCOMPLETE') return 'Checkout tidak tercatat';
    if (record.status === 'LEAVE') return this.leaveLabel(record.leaveType);
    if (record.status === 'PRESENT') return 'Tepat waktu';
    if (record.status === 'OFF') return 'Tidak dijadwalkan bertugas';
    return 'Belum ada check-in';
  }

  jakartaTime(timestamp: string | null): string {
    if (!timestamp) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(timestamp));
  }

  private leaveLabel(type: AdminAttendanceRecord['leaveType']): string {
    if (!type) return 'Izin disetujui';
    return {
      SICK: 'Sakit',
      OFFICIAL_DUTY: 'Dinas luar',
      FAMILY: 'Kepentingan keluarga',
      OTHER: 'Lainnya',
      LATE_ARRIVAL: 'Izin terlambat',
      MATERNITY_LEAVE: 'Cuti Melahirkan',
    }[type];
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
