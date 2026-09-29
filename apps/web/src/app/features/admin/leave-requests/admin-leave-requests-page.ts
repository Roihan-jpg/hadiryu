import type { AdminLeaveRequest, DecideLeaveRequest, LeaveStatus } from '@absensi/contracts';
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
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { LeaveRequestsService } from '../../leave-requests/leave-requests.service';
import { focusFirstInvalidControl } from '../../../core/ui/form-focus';
import { createIndonesianPaginatorIntl } from '../../../core/ui/paginator-intl';

type StatusFilter = LeaveStatus | 'ALL';
type DecisionAction = 'APPROVED' | 'REJECTED';

interface LeaveDecisionDialogData {
  request: AdminLeaveRequest;
  action: DecisionAction;
}

@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.action === 'APPROVED' ? 'Setujui izin?' : 'Tolak izin?' }}</h2>
    <mat-dialog-content>
      <p>
        {{ data.request.teacherFullName }} mengajukan izin untuk
        <strong>{{ dateLabel(data.request.leaveDate) }}</strong>.
      </p>
      <p class="reason">{{ data.request.reason }}</p>
      <mat-form-field appearance="outline">
        <mat-label>Catatan keputusan (opsional)</mat-label>
        <textarea matInput rows="3" maxlength="1000" name="decisionNote" autocomplete="off" [formControl]="decisionNote"></textarea>
        @if (decisionNote.invalid) {
          <mat-error>Catatan maksimal 1.000 karakter.</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="undefined">Batal</button>
      <button mat-flat-button type="button" (click)="submit()">
        {{ data.action === 'APPROVED' ? 'Setujui izin' : 'Tolak izin' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { width: min(32rem, 72vw); }
    mat-form-field { width: 100%; margin-top: .75rem; }
    .reason { color: #42536b; }
    @media (max-width: 520px) { mat-dialog-content { width: auto; } }
  `,
})
export class LeaveDecisionDialog {
  readonly data = inject<LeaveDecisionDialogData>(MAT_DIALOG_DATA);
  readonly decisionNote = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(1000)],
  });
  private readonly dialogRef = inject(MatDialogRef<LeaveDecisionDialog>);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  dateLabel(workDate: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  }

  submit(): void {
    if (this.decisionNote.invalid) {
      this.decisionNote.markAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const decisionNote = this.decisionNote.value.trim();
    this.dialogRef.close(decisionNote ? { decisionNote } : {});
  }
}

@Component({
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, MatProgressSpinnerModule, MatSelectModule, FormsModule, ReactiveFormsModule, RouterLink],
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  selector: 'app-admin-leave-requests-page', styleUrl: './admin-leave-requests-page.scss', templateUrl: './admin-leave-requests-page.html',
})
export class AdminLeaveRequestsPage implements OnInit {
  private readonly service = inject(LeaveRequestsService);
  private readonly dialog = inject(MatDialog);
  readonly statusControl = new FormControl<StatusFilter>('PENDING', { nonNullable: true });
  readonly dateControl = new FormControl('', { nonNullable: true });
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly requests = signal<AdminLeaveRequest[]>([]);
  readonly loading = signal(true);
  readonly actionInProgress = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly pagination = signal({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading.set(true); this.errorMessage.set('');
    try {
      const page = this.pagination();
      const result = await this.service.listAdmin({
        page: page.page, pageSize: page.pageSize,
        ...(this.statusControl.value === 'ALL' ? {} : { status: this.statusControl.value }),
        ...(this.dateControl.value ? { leaveDate: this.dateControl.value } : {}),
        ...(this.searchControl.value.trim() ? { search: this.searchControl.value.trim() } : {}),
      });
      this.requests.set(result.data); this.pagination.set(result.pagination);
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Daftar approval izin tidak dapat dimuat.')); }
    finally { this.loading.set(false); }
  }

  async applyFilter(): Promise<void> {
    this.pagination.update((page) => ({ ...page, page: 1 }));
    await this.load();
  }

  async pageChanged(event: PageEvent): Promise<void> {
    this.pagination.update((page) => ({ ...page, page: event.pageIndex + 1, pageSize: event.pageSize }));
    await this.load();
  }

  openDecision(request: AdminLeaveRequest, action: DecisionAction): void {
    if (request.status !== 'PENDING' || this.actionInProgress()) return;
    const reference = this.dialog.open(LeaveDecisionDialog, {
      data: { request, action } satisfies LeaveDecisionDialogData,
      width: '36rem',
    });
    reference.afterClosed().subscribe((input: DecideLeaveRequest | undefined) => {
      if (input !== undefined) void this.decide(request, action, input);
    });
  }

  async decide(request: AdminLeaveRequest, action: DecisionAction, input?: DecideLeaveRequest): Promise<void> {
    if (request.status !== 'PENDING' || this.actionInProgress()) return;
    this.actionInProgress.set(request.id); this.errorMessage.set(''); this.successMessage.set('');
    try {
      await this.service.decide(request.id, action, input);
      this.successMessage.set(action === 'APPROVED' ? 'Izin berhasil disetujui.' : 'Izin berhasil ditolak.');
      await this.load();
    } catch (error) { this.errorMessage.set(await this.errorText(error, 'Keputusan izin tidak dapat disimpan.')); }
    finally { this.actionInProgress.set(null); }
  }

  typeLabel(type: AdminLeaveRequest['leaveType']): string { return ({ SICK: 'Sakit', OFFICIAL_DUTY: 'Dinas Luar', FAMILY: 'Kepentingan Keluarga', OTHER: 'Lainnya', LATE_ARRIVAL: 'Izin terlambat', MATERNITY_LEAVE: 'Cuti Melahirkan' })[type]; }
  statusLabel(status: LeaveStatus): string { return ({ PENDING: 'Pending', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan' })[status]; }
  dateLabel(workDate: string): string {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
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
