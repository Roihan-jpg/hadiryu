import type {
  CreateTeacherRequest,
  PasswordResetResult,
  Teacher,
  UpdateTeacherRequest,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  FormsModule,
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
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';

import { TeachersService } from './teachers.service';
import { focusFirstInvalidControl } from '../../../core/ui/form-focus';
import { createIndonesianPaginatorIntl } from '../../../core/ui/paginator-intl';

interface TeacherFormValue {
  nip: string;
  fullName: string;
  initialPassword?: string;
  whatsappNumber: string | null;
  role?: 'USER' | 'SECURITY_GUARD';
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
    <h2 mat-dialog-title>{{ teacher ? 'Ubah profil akun' : 'Tambah akun' }}</h2>
    <mat-dialog-content>
      <form class="dialog-form" [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>NIP</mat-label>
          <input matInput formControlName="nip" name="nip" autocomplete="off" spellcheck="false" />
          @if (form.controls.nip.invalid) {
            <mat-error>NIP wajib diisi dengan format yang valid.</mat-error>
          }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Nomor WhatsApp (opsional)</mat-label>
          <input matInput formControlName="whatsappNumber" name="whatsappNumber" placeholder="+628123456789" autocomplete="tel" />
          @if (form.controls.whatsappNumber.invalid) { <mat-error>Gunakan format internasional, contoh +628123456789.</mat-error> }
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Nama lengkap</mat-label>
          <input matInput formControlName="fullName" name="fullName" autocomplete="name" />
          @if (form.controls.fullName.invalid) {
            <mat-error>Nama lengkap wajib diisi.</mat-error>
          }
        </mat-form-field>
        @if (!teacher) {
          <mat-form-field appearance="outline">
            <mat-label>Role</mat-label>
            <select matNativeControl formControlName="role" name="role"><option value="USER">Guru</option><option value="SECURITY_GUARD">Satpam</option></select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password awal</mat-label>
            <input
              matInput
              type="password"
              formControlName="initialPassword"
              name="initialPassword"
              autocomplete="new-password"
            />
            @if (form.controls.initialPassword.invalid) {
              <mat-error>Password harus tepat 8 karakter, berisi huruf besar, huruf kecil, dan angka.</mat-error>
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly form = new FormGroup({
    nip: new FormControl(this.teacher?.nip ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(64), Validators.pattern(/^[a-zA-Z0-9._-]+$/)],
    }),
    fullName: new FormControl(this.teacher?.fullName ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    whatsappNumber: new FormControl(this.teacher?.whatsappNumber ?? '', {
      nonNullable: true,
      validators: [Validators.pattern(/^$|^\+[1-9]\d{7,14}$/)],
    }),
    initialPassword: new FormControl('', {
      nonNullable: true,
      validators: this.teacher
        ? []
        : [Validators.required, Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/)],
    }),
    role: new FormControl<'USER' | 'SECURITY_GUARD'>(this.teacher?.role ?? 'USER', { nonNullable: true }),
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const value = this.form.getRawValue();
    this.dialogRef.close({
      nip: value.nip.trim(),
      fullName: value.fullName.trim(),
      whatsappNumber: value.whatsappNumber.trim() || null,
      ...(this.teacher ? {} : { initialPassword: value.initialPassword }),
      ...(this.teacher ? {} : { role: value.role }),
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
      <p>Server akan membuat password baru delapan karakter dan mencabut seluruh sesi Guru.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="undefined">Batal</button>
      <button mat-flat-button type="button" (click)="submit()">Reset password</button>
    </mat-dialog-actions>
  `,
  styles: `p { color: #58677d; line-height: 1.5; }`,
})
export class ResetPasswordDialog {
  private readonly dialogRef = inject(MatDialogRef<ResetPasswordDialog>);
  submit(): void {
    this.dialogRef.close(true);
  }
}

@Component({
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Password baru dibuat</h2>
    <mat-dialog-content><p>Simpan sekarang. Password baru hanya ditampilkan sekali.</p><div class="secret"><code>{{ data.newPassword }}</code><button mat-stroked-button type="button" (click)="copy()">{{ copied() ? 'Tersalin' : 'Salin' }}</button></div></mat-dialog-content>
    <mat-dialog-actions align="end"><button mat-flat-button type="button" [mat-dialog-close]="true">Selesai</button></mat-dialog-actions>
  `,
  styles: `.secret{display:flex;align-items:center;gap:12px;padding:14px;background:#f4eee6;border-radius:6px}.secret code{flex:1;font-size:15px;overflow-wrap:anywhere}p{color:#687570;line-height:1.55}`,
})
export class ResetPasswordResultDialog {
  readonly data = inject<PasswordResetResult>(MAT_DIALOG_DATA);
  readonly copied = signal(false);
  async copy(): Promise<void> { await navigator.clipboard.writeText(this.data.newPassword); this.copied.set(true); }
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
    MatSelectModule,
    MatTableModule,
    FormsModule,
    ReactiveFormsModule,
  ],
  selector: 'app-teachers-page',
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  styleUrl: './teachers-page.scss',
  templateUrl: './teachers-page.html',
})
export class TeachersPage implements OnInit {
  private readonly service = inject(TeachersService);
  private readonly dialog = inject(MatDialog);

  readonly displayedColumns = ['teacher', 'nip', 'whatsapp', 'status', 'actions'];
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly statusControl = new FormControl<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL', { nonNullable: true });
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
        ...(this.statusControl.value === 'ALL' ? {} : { isActive: this.statusControl.value === 'ACTIVE' }),
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
      void this.updateTeacher(teacher, { nip: value.nip, fullName: value.fullName, whatsappNumber: value.whatsappNumber });
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
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed) void this.performPasswordReset(teacher);
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
  ): Promise<void> {
    if (this.actionInProgress()) return;
    this.actionInProgress.set(teacher.id);
    this.clearFeedback();
    try {
      const result = await this.service.resetPassword(teacher.id);
      this.dialog.open(ResetPasswordResultDialog, { data: result, width: '34rem', disableClose: true });
      this.successMessage.set('Password Guru berhasil direset dan berlaku 72 jam.');
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
