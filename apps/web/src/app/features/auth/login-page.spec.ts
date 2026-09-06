import type { AuthUser } from '@absensi/contracts';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { OpeningTransitionService } from '../../core/opening/opening-transition.service';
import { LoginPage } from './login-page';

const firstLoginUser: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  role: 'USER',
  isActive: true,
  mustChangePassword: true,
};

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  const login = vi.fn(async () => firstLoginUser);
  const playOpening = vi.fn(async () => undefined);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { user: signal(null).asReadonly(), login },
        },
        {
          provide: OpeningTransitionService,
          useValue: { play: playOpening },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    login.mockClear();
    playOpening.mockClear();
  });

  it('does not submit an invalid or empty login form', async () => {
    await fixture.componentInstance.submit();
    fixture.detectChanges();

    expect(login).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('NIP wajib diisi');
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('input[formControlName="nip"]'),
    );
  });

  it('prevents double submit and routes first-login users to change password', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.form.setValue({
      nip: '001234567890',
      password: 'password-awal',
    });

    const first = fixture.componentInstance.submit();
    const second = fixture.componentInstance.submit();
    await Promise.all([first, second]);

    expect(login).toHaveBeenCalledTimes(1);
    expect(playOpening).toHaveBeenCalledWith(firstLoginUser);
    expect(navigate).toHaveBeenCalledWith('/change-password');
  });

  it('lets the user reveal and hide the password accessibly', () => {
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input[formControlName="password"]');
    const toggle = element.querySelector<HTMLButtonElement>('[data-action="toggle-password"]');

    expect(input?.type).toBe('password');
    toggle?.click();
    fixture.detectChanges();
    expect(input?.type).toBe('text');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  });
});
