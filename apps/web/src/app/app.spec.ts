import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { afterEach, vi } from 'vitest';

import { AuthService } from './core/auth/auth.service';
import { LOTTIE_MODULE_LOADER } from './core/opening/opening-screen';
import { OpeningTransitionService, type OpeningPhase } from './core/opening/opening-transition.service';
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
  let openingPhase: WritableSignal<OpeningPhase>;
  const playInitialLoad = vi.fn(async () => undefined);

  beforeEach(async () => {
    localStorage.removeItem('admin-sidebar-collapsed');
    user = signal(null);
    openingPhase = signal<OpeningPhase>('idle');
    playInitialLoad.mockClear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient()),
        {
          provide: AuthService,
          useValue: { user: user.asReadonly(), logout: async () => undefined },
        },
        {
          provide: OpeningTransitionService,
          useValue: { phase: openingPhase.asReadonly(), playInitialLoad },
        },
        {
          provide: LOTTIE_MODULE_LOADER,
          useValue: async () => { throw new Error('fallback for root test'); },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => localStorage.removeItem('admin-sidebar-collapsed'));

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    expect(playInitialLoad).toHaveBeenCalledTimes(1);
  });

  it('renders the guest brand without an application toolbar', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-toolbar')).toBeNull();
    expect(compiled.querySelector('main')?.classList).toContain('guest-main');
  });

  it('covers the app only while the post-login opening is active', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-opening-screen')).toBeNull();

    openingPhase.set('showing');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.opening-screen')).not.toBeNull();

    openingPhase.set('idle');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-opening-screen')).toBeNull();
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

  it('uses the shared profile mobile header to open the matching role drawer', () => {
    user.set({
      id: '10000000-0000-4000-8000-000000000004',
      nip: '198503242010011015',
      fullName: 'Admin Contoh',
      role: 'SUPER_ADMIN',
      isActive: true,
      mustChangePassword: false,
      photo: null,
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector<HTMLAnchorElement>('.app-mobile-header__brand')?.getAttribute('href')).toBe('/admin');
    expect(
      compiled
        .querySelector<HTMLImageElement>('.app-mobile-header__brand-logo')
        ?.getAttribute('src'),
    ).toBe('/assets/brand/hadiryu-on-dark.png');
    expect(compiled.querySelector<HTMLAnchorElement>('.app-mobile-header a[href="/profile"]')?.getAttribute('aria-label')).toBe('Buka profil Admin Contoh');
    const adminButton = compiled.querySelector<HTMLButtonElement>('[aria-label="Buka menu Super Admin"]');
    adminButton?.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.admin-shell')?.classList).toContain('drawer-open');

    user.set({ ...user()!, role: 'USER' });
    fixture.detectChanges();
    expect(compiled.querySelector<HTMLAnchorElement>('.app-mobile-header__brand')?.getAttribute('href')).toBe('/guru');
    expect(compiled.querySelector<HTMLAnchorElement>('.app-mobile-header a[href="/profile"]')?.getAttribute('aria-label')).toBe('Buka profil Admin Contoh');
    const teacherButton = compiled.querySelector<HTMLButtonElement>('[aria-label="Buka menu Guru"]');
    teacherButton?.click();
    fixture.detectChanges();
    expect(compiled.querySelector('.teacher-app-shell')?.classList).toContain('drawer-open');
  });

  it('shares the compact-sidebar preference with the Guru sidebar', () => {
    user.set({
      id: '10000000-0000-4000-8000-000000000003',
      nip: '198503242010011014',
      fullName: 'Guru Contoh',
      role: 'USER',
      isActive: true,
      mustChangePassword: false,
      photo: null,
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('[aria-label="Ringkas sidebar"]')?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.teacher-app-shell')?.classList).toContain('sidebar-collapsed');
    expect(compiled.querySelector<HTMLAnchorElement>('.app-sidebar__nav a')?.getAttribute('title')).toBeTruthy();
  });

  it('uses the same account-card structure for Super Admin and Guru sidebars', () => {
    user.set({
      id: '10000000-0000-4000-8000-000000000002',
      nip: '198503242010011013',
      fullName: 'Admin Contoh',
      role: 'SUPER_ADMIN',
      isActive: true,
      mustChangePassword: false,
      photo: null,
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const compactButton = compiled.querySelector<HTMLButtonElement>('[aria-label="Ringkas sidebar"]');

    expect(compiled.querySelector('.app-sidebar--admin .app-sidebar__account-card')).not.toBeNull();
    expect(compiled.querySelector('.app-sidebar--admin .app-sidebar__school')).toBeNull();
    expect(
      compiled
        .querySelector<HTMLImageElement>('.app-sidebar__brand-logo')
        ?.getAttribute('src'),
    ).toBe('/assets/brand/hadiryu-on-light.png');
    expect(compiled.querySelector('.app-sidebar__brand-mark')).toBeNull();
    expect(compiled.querySelector('.app-sidebar__avatar')?.textContent?.trim()).toBe(
      'AC',
    );
    compactButton?.click();
    fixture.detectChanges();

    expect(compiled.querySelector('.admin-shell')?.classList).toContain('sidebar-collapsed');
    expect(compiled.querySelector<HTMLAnchorElement>('.app-sidebar__nav a')?.getAttribute('title')).toBeTruthy();
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
