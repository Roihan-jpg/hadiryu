import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth/auth.service';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { AppMobileHeader } from './core/layout/app-mobile-header';
import { AppSidebar, SidebarNavigationItem } from './core/layout/app-sidebar';
import { OpeningScreen } from './core/opening/opening-screen';
import { OpeningTransitionService } from './core/opening/opening-transition.service';

@Component({
  imports: [AppMobileHeader, AppSidebar, OpeningScreen, RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly opening = inject(OpeningTransitionService);
  private readonly router = inject(Router);

  protected readonly appName = 'Absensi';
  protected readonly user = this.auth.user;
  protected readonly openingPhase = this.opening.phase;
  protected readonly adminMenuOpen = signal(false);
  protected readonly teacherMenuOpen = signal(false);
  protected readonly sidebarCollapsed = signal(this.savedSidebarState());
  protected readonly adminNavigation: readonly SidebarNavigationItem[] = [
    { path: '/admin', label: 'Monitoring', exact: true, icon: 'M4 13h6V4H4v9zm0 7h6v-4H4v4zm10 0h6v-9h-6v9zm0-16v4h6V4h-6z' },
    { path: '/admin/teachers', label: 'Master Guru', exact: false, icon: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
    { path: '/admin/leave-requests', label: 'Approval Izin', exact: false, icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
    { path: '/admin/early-departure-requests', label: 'Approval Pulang Awal', exact: false, icon: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z' },
    { path: '/admin/reports', label: 'Laporan', exact: false, icon: 'M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2zm4-4h8M8 11h8M8 7h4' },
    { path: '/admin/settings', label: 'Pengaturan', exact: false, icon: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7.4-3.5a7.3 7.3 0 00-.1-1l2-1.6-2-3.4-2.4 1a7.8 7.8 0 00-1.8-1L14.8 3h-4l-.4 3a7.8 7.8 0 00-1.8 1L6.2 6 4.2 9.4l2 1.6a7.3 7.3 0 000 2L4.2 14.6l2 3.4 2.4-1a7.8 7.8 0 001.8 1l.4 3h4l.4-3a7.8 7.8 0 001.8-1l2.4 1 2-3.4-2-1.6a7.3 7.3 0 00.1-1z' },
    { path: '/admin/audit', label: 'Audit Log', exact: false, icon: 'M9 12l2 2 4-4m5-5v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V5l8-3 8 3z' },
    { path: '/admin/guide', label: 'Panduan', exact: false, icon: 'M4 19.5A2.5 2.5 0 016.5 17H20V4H6.5A2.5 2.5 0 004 6.5v13zm0 0A2.5 2.5 0 006.5 22H20' },
    { path: '/profile', label: 'Profil Saya', exact: false, icon: 'M20 21a8 8 0 00-16 0m8-10a4 4 0 100-8 4 4 0 000 8z' },
  ];
  protected readonly teacherNavigation: readonly SidebarNavigationItem[] = [
    { path: '/guru', label: 'Dashboard', exact: true, icon: 'M4 10.5L12 4l8 6.5V20h-5v-6H9v6H4v-9.5z' },
    { path: '/guru/riwayat', label: 'Riwayat', exact: false, icon: 'M4 5v5h5M5.2 15a8 8 0 101.4-8.9L4 10m8-4v6l4 2' },
    { path: '/guru/izin', label: 'Izin', exact: false, icon: 'M7 3h10v4h4v14H3V7h4V3zm2 0v6h6V3M7 13h10M7 17h7' },
    { path: '/guru/pulang-awal', label: 'Pulang awal', exact: false, icon: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z' },
    { path: '/profile', label: 'Profil Saya', exact: false, icon: 'M20 21a8 8 0 00-16 0m8-10a4 4 0 100-8 4 4 0 000 8z' },
  ];

  protected readonly logoutMutation = injectMutation(() => ({
    mutationFn: () => this.auth.logout(),
    onSuccess: () => this.router.navigateByUrl('/login'),
  }));

  constructor() {
    void this.opening.playInitialLoad();
  }

  protected logout(): void { this.logoutMutation.mutate(); }

  protected toggleAdminMenu(): void {
    this.adminMenuOpen.update((open) => !open);
  }

  protected closeAdminMenu(): void {
    this.adminMenuOpen.set(false);
  }

  protected toggleTeacherMenu(): void {
    this.teacherMenuOpen.update((open) => !open);
  }

  protected closeTeacherMenu(): void {
    this.teacherMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected closeOpenMenu(): void {
    this.adminMenuOpen.set(false);
    this.teacherMenuOpen.set(false);
  }

  protected toggleSidebar(): void {
    this.sidebarCollapsed.update((collapsed) => !collapsed);
    try { localStorage.setItem('admin-sidebar-collapsed', String(this.sidebarCollapsed())); } catch { /* storage may be unavailable */ }
  }

  private savedSidebarState(): boolean {
    try { return localStorage.getItem('admin-sidebar-collapsed') === 'true'; } catch { return false; }
  }

}
