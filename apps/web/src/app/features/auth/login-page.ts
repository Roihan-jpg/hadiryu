import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { focusFirstInvalidControl } from '../../core/ui/form-focus';

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  selector: 'app-login-page',
  styleUrl: './login-page.scss',
  templateUrl: './login-page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);

  readonly isSubmitting = signal(false);
  readonly passwordVisible = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly form = new FormGroup({
    nip: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(64)],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

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
      const user = await this.auth.login(this.form.getRawValue());
      const destination = user.mustChangePassword
        ? '/change-password'
        : user.role === 'SUPER_ADMIN'
          ? '/admin'
          : '/guru';
      await this.router.navigateByUrl(destination);
    } catch (error) {
      this.errorMessage.set(this.messageFor(error));
    } finally {
      this.isSubmitting.set(false);
    }
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const apiMessage = (error.error as { error?: { message?: string } })
        ?.error?.message;
      if (apiMessage) return apiMessage;
    }
    return 'Login gagal. Periksa koneksi lalu coba lagi.';
  }
}
