import type {
  CreateTeacherRequest,
  ResetTeacherPasswordRequest,
  Teacher,
  UpdateTeacherRequest,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';

import { TeachersService } from './teachers.service';

interface TeacherFormValue {
  nip: string;
  fullName: string;
  initialPassword?: string;
}

interface ConfirmDialogData {
  title: string;
  message: string;
  actionLabel: string;
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
    <h2 mat-dialog-title>{{ teacher ? 'Ubah profil Guru' : 'Tambah Guru' }}</h2>
    <mat-dialog-content>
      <form class="dialog-form" [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>NIP</mat-label>
          <input matInput formControlName="nip" autocomplete="off" />
          @if (form.controls.nip.invalid) {
            <mat-error>NIP wajib diisi dengan format yang valid.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Nama lengkap</mat-label>
          <input matInput formControlName="fullName" autocomplete="name" />
          @if (form.controls.fullName.invalid) {
            <mat-error>Nama lengkap wajib diisi.</mat-error>
          }
        </mat-form-field>
        @if (!teacher) {
          <mat-form-field appearance="outline">
            <mat-label>Password awal</mat-label>
            <input
              matInput
              type="password"
              formControlName="initialPassword"
              autocomplete="new-password"
            />
            @if (form.controls.initialPassword.invalid) {
              <mat-error>Password awal minimal 8 karakter.</mat-error>
            }
          </mat-form-field>
        }
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="undefined">Batal</button>
      <button mat-flat-button type="button" (click)="submit()">
        {{ teacher ? 'Simpan perubahan' : 'Tambah Guru' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form { display: grid; gap: 0.25rem; padding-top: 0.5rem; min-width: min(28rem, 72vw); }
    mat-form-field { width: 100%; }
    @media (max-width: 520px) { .dialog-form { min-width: 0; } }
  `,
})
export class TeacherFormDialog {
  readonly teacher = inject<Teacher | null>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TeacherFormDialog>);
  readonly form = new FormGroup({
    nip: new FormControl(this.teacher?.nip ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(64), Validators.pattern(/^[a-zA-Z0-9._-]+$/)],
    }),
    fullName: new FormControl(this.teacher?.fullName ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    initialPassword: new FormControl('', {
      nonNullable: true,
      validators: this.teacher
        ? []
        : [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
    }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    this.dialogRef.close({
      nip: value.nip.trim(),
      fullName: value.fullName.trim(),
      ...(this.teacher ? {} : { initialPassword: value.initialPassword }),
    } satisfies TeacherFormValue);
  }
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
    <h2 mat-dialog-title>Reset password Guru</h2>
    <mat-dialog-content>
      <p>Guru akan wajib mengganti password sementara ini saat login berikutnya.</p>
      <mat-form-field appearance="outline">
        <mat-label>Password sementara</mat-label>
        <input
          matInput
          type="password"
          [formControl]="password"
          autocomplete="new-password"
          (keydown.enter)="submit()"
        />
        @if (password.invalid) {
          <mat-error>Password sementara minimal 8 karakter.</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="undefined">Batal</button>
      <button mat-flat-button type="button" (click)="submit()">Reset password</button>
    </mat-dialog-actions>
  `,
  styles: `mat-form-field { width: 100%; } p { color: #58677d; line-height: 1.5; }`,
})
export class ResetPasswordDialog {
  private readonly dialogRef = inject(MatDialogRef<ResetPasswordDialog>);
  readonly password = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(8), Validators.maxLength(128)],
  });

  submit(): void {
    if (this.password.invalid) {
      this.password.markAsTouched();
      return;
    }
    this.dialogRef.close({
      temporaryPassword: this.password.value,
    } satisfies ResetTeacherPasswordRequest);
  }
}

@Component({
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p>{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false">Batal</button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">
        {{ data.actionLabel }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmTeacherDialog {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}

@Component({
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
    ReactiveFormsModule,
  ],
  selector: 'app-teachers-page',
  styleUrl: './teachers-page.scss',
  templateUrl: './teachers-page.html',
})
export class TeachersPage implements OnInit {
  private readonly service = inject(TeachersService);
  private readonly dialog = inject(MatDialog);

  readonly displayedColumns = ['teacher', 'nip', 'status', 'password', 'actions'];
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly teachers = signal<Teacher[]>([]);
  readonly loading = signal(true);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly actionInProgress = signal<string | null>(null);
  readonly pagination = signal({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });

  ngOnInit(): void {
    void this.loadTeachers();
  }

  async loadTeachers(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const page = this.pagination();
      const search = this.searchControl.value.trim();
      const result = await this.service.list({
        ...(search ? { search } : {}),
        page: page.page,
        pageSize: page.pageSize,
      });
      this.teachers.set(result.data);
      this.pagination.set(result.pagination);
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Daftar Guru tidak dapat dimuat.'));
    } finally {
      this.loading.set(false);
    }
  }

  async applySearch(): Promise<void> {
    this.searchControl.setValue(this.searchControl.value.trim());
    this.pagination.update((value) => ({ ...value, page: 1 }));
    await this.loadTeachers();
  }

  async pageChanged(event: PageEvent): Promise<void> {
    this.pagination.update((value) => ({
      ...value,
      page: event.pageIndex + 1,
      pageSize: event.pageSize,
    }));
    await this.loadTeachers();
  }

  openCreateDialog(): void {
    const reference = this.dialog.open(TeacherFormDialog, {
      data: null,
      width: '32rem',
    });
    reference.afterClosed().subscribe((value: TeacherFormValue | undefined) => {
      if (value?.initialPassword) void this.createTeacher(value as CreateTeacherRequest);
    });
  }

  openEditDialog(teacher: Teacher): void {
    const reference = this.dialog.open(TeacherFormDialog, {
      data: teacher,
      width: '32rem',
    });
    reference.afterClosed().subscribe((value: TeacherFormValue | undefined) => {
      if (!value) return;
      void this.updateTeacher(teacher, { nip: value.nip, fullName: value.fullName });
    });
  }

  confirmActiveStatus(teacher: Teacher): void {
    const activating = !teacher.isActive;
    const reference = this.dialog.open(ConfirmTeacherDialog, {
      data: {
        title: activating ? 'Aktifkan Guru?' : 'Nonaktifkan Guru?',
        message: activating
          ? `${teacher.fullName} akan dapat login kembali.`
          : `${teacher.fullName} tidak dapat login, tetapi seluruh histori tetap tersimpan.`,
        actionLabel: activating ? 'Aktifkan' : 'Nonaktifkan',
      } satisfies ConfirmDialogData,
      width: '28rem',
    });
    reference.afterClosed().subscribe((confirmed: boolean | undefined) => {
      if (confirmed) void this.changeActiveStatus(teacher);
    });
  }

  openResetPasswordDialog(teacher: Teacher): void {
    const reference = this.dialog.open(ResetPasswordDialog, { width: '30rem' });
    reference
      .afterClosed()
      .subscribe((input: ResetTeacherPasswordRequest | undefined) => {
        if (input) void this.performPasswordReset(teacher, input);
      });
  }

  async changeActiveStatus(teacher: Teacher): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(teacher.id);
    this.clearFeedback();
    try {
      await this.service.setActive(teacher.id, !teacher.isActive);
      this.successMessage.set(
        teacher.isActive ? 'Guru berhasil dinonaktifkan.' : 'Guru berhasil diaktifkan.',
      );
      await this.loadTeachers();
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Status Guru tidak dapat diubah.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async createTeacher(input: CreateTeacherRequest): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set('create');
    this.clearFeedback();
    try {
      await this.service.create(input);
      this.successMessage.set('Guru berhasil ditambahkan.');
      this.pagination.update((value) => ({ ...value, page: 1 }));
      await this.loadTeachers();
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Guru tidak dapat ditambahkan.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async updateTeacher(
    teacher: Teacher,
    input: UpdateTeacherRequest,
  ): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(teacher.id);
    this.clearFeedback();
    try {
      await this.service.update(teacher.id, input);
      this.successMessage.set('Profil Guru berhasil diperbarui.');
      await this.loadTeachers();
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Profil Guru tidak dapat diperbarui.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async performPasswordReset(
    teacher: Teacher,
    input: ResetTeacherPasswordRequest,
  ): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(teacher.id);
    this.clearFeedback();
    try {
      await this.service.resetPassword(teacher.id, input);
      this.successMessage.set('Password Guru berhasil direset.');
      await this.loadTeachers();
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Password Guru tidak dapat direset.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private clearFeedback(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { error?: { message?: unknown } } | null)
        ?.error?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  }
}
