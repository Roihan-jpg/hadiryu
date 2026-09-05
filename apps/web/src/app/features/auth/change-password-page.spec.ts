import type { AuthUser } from '@absensi/contracts';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { ChangePasswordPage } from './change-password-page';

const teacher: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: true,
};

describe('ChangePasswordPage auth completion', () => {
  let fixture: ComponentFixture<ChangePasswordPage>;
  const changePassword = vi.fn(async () => ({
    ...teacher,
    mustChangePassword: false,
  }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChangePasswordPage],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: signal(teacher).asReadonly(),
            changePassword,
            logout: vi.fn(),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChangePasswordPage);
    fixture.detectChanges();
    changePassword.mockClear();
  });

  it('rejects a confirmation that differs from the new password', async () => {
    fixture.componentInstance.form.setValue({
      currentPassword: 'password-awal',
      newPassword: 'Aa123456',
      confirmPassword: 'Bb123456',
    });

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(changePassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Konfirmasi password tidak sama',
    );
  });

  it('requires exactly eight alphanumeric characters with mixed case and a number', async () => {
    fixture.componentInstance.form.setValue({
      currentPassword: 'password-awal',
      newPassword: 'semuakecil',
      confirmPassword: 'semuakecil',
    });

    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(changePassword).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Gunakan tepat 8 karakter dengan huruf besar, huruf kecil, dan angka.',
    );
  });

  it('explains every required password field in Indonesian', async () => {
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Password saat ini wajib diisi.');
    expect(text).toContain('Password baru wajib diisi.');
    expect(text).toContain('Ulangi password baru.');
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector(
        'input[formControlName="currentPassword"]',
      ),
    );
  });

  it('changes the initial password and routes according to the server role', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.form.setValue({
      currentPassword: 'password-awal',
      newPassword: 'Aa123456',
      confirmPassword: 'Aa123456',
    });

    await fixture.componentInstance.submit();

    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'password-awal',
      newPassword: 'Aa123456',
    });
    expect(navigate).toHaveBeenCalledWith('/guru');
  });
});
