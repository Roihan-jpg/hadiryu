import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { AuthService } from './core/auth/auth.service';
import { App } from './app';

describe('App', () => {
  let user: WritableSignal<{
    id: string;
    nip: string;
    fullName: string;
    role: 'USER' | 'SUPER_ADMIN';
    isActive: boolean;
    mustChangePassword: boolean;
    photo: null;
  } | null>;

  beforeEach(async () => {
    user = signal(null);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient()),
        {
          provide: AuthService,
          useValue: { user: user.asReadonly(), logout: async () => undefined },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the guest brand without an application toolbar', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-toolbar')).toBeNull();
    expect(compiled.querySelector('main')?.classList).toContain('guest-main');
  });

  it('renders the dedicated Guru shell and opens its navigation drawer', async () => {
    user.set({
      id: '10000000-0000-4000-8000-000000000001',
      nip: '198503242010011012',
      fullName: 'Siti Aminah, S.Pd.',
      role: 'USER',
      isActive: true,
      mustChangePassword: false,
      photo: null,
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.teacher-app-shell')).not.toBeNull();
    expect(compiled.querySelector('nav[aria-label="Navigasi Guru"]')).not.toBeNull();
    expect(compiled.querySelector('.teacher-topbar nav')).toBeNull();

    const menuButton = compiled.querySelector<HTMLButtonElement>('[aria-label="Buka menu Guru"]');
    menuButton?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.teacher-app-shell')?.classList).toContain('drawer-open');
    expect(menuButton?.getAttribute('aria-expanded')).toBe('true');
  });

  it('provides a keyboard skip link to the main content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector<HTMLAnchorElement>('.skip-link')?.hash).toBe(
      '#main-content',
    );
    expect(compiled.querySelector('main')?.id).toBe('main-content');
  });
});
