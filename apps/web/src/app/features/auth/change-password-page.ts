import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { focusFirstInvalidControl } from '../../core/ui/form-focus';

function matchingPasswords(control: AbstractControl): ValidationErrors | null {
  const newPassword = control.get('newPassword')?.value as string | undefined;
  const confirmationControl = control.get('confirmPassword');
  const confirmation = confirmationControl?.value as string | undefined;
  const errors = { ...(confirmationControl?.errors ?? {}) };

  if (newPassword !== confirmation) {
    confirmationControl?.setErrors({ ...errors, passwordMismatch: true });
    return { passwordMismatch: true };
  }

  delete errors['passwordMismatch'];
  confirmationControl?.setErrors(
    Object.keys(errors).length === 0 ? null : errors,
  );
  return null;
}

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-change-password-page',
  styleUrl: './change-password-page.scss',
  templateUrl: './change-password-page.html',
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly form = new FormGroup(
    {
      currentPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      newPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(8)],
      }),
      confirmPassword: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: matchingPasswords },
  );

  async submit(): Promise<void> {
    if (this.isSubmitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    try {
      const values = this.form.getRawValue();
      const user = await this.auth.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      await this.router.navigateByUrl(
        user.role === 'SUPER_ADMIN' ? '/admin' : '/guru',
      );
    } catch (error) {
      this.errorMessage.set(this.messageFor(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { error?: { message?: string } })
        ?.error?.message;
      if (message) return message;
    }
    return 'Password belum dapat diganti. Periksa koneksi lalu coba lagi.';
  }
}
