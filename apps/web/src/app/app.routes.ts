import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  passwordChangedGuard,
  roleGuard,
} from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'guru/izin',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('USER')],
    loadComponent: () =>
      import('./features/leave-requests/leave-requests-page').then(
        (module) => module.LeaveRequestsPage,
      ),
  },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login-page').then((module) => module.LoginPage),
  },
  {
    path: 'admin/leave-requests',
    canActivate: [
      authGuard,
      passwordChangedGuard,
      roleGuard('SUPER_ADMIN'),
    ],
    loadComponent: () =>
      import('./features/admin/leave-requests/admin-leave-requests-page').then(
        (module) => module.AdminLeaveRequestsPage,
      ),
  },
  {
    path: 'change-password',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/auth/change-password-page').then(
        (module) => module.ChangePasswordPage,
      ),
  },
  {
    path: 'guru/riwayat',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('USER')],
    loadComponent: () =>
      import('./features/attendance/attendance-history-page').then(
        (module) => module.AttendanceHistoryPage,
      ),
  },
  {
    path: 'guru',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('USER')],
    loadComponent: () =>
      import('./features/home/home-page').then((module) => module.HomePage),
  },
  {
    path: 'admin/settings',
    canActivate: [
      authGuard,
      passwordChangedGuard,
      roleGuard('SUPER_ADMIN'),
    ],
    loadComponent: () =>
      import('./features/admin/settings/settings-page').then(
        (module) => module.SettingsPage,
      ),
  },
  {
    path: 'admin/teachers',
    canActivate: [
      authGuard,
      passwordChangedGuard,
      roleGuard('SUPER_ADMIN'),
    ],
    loadComponent: () =>
      import('./features/admin/teachers/teachers-page').then(
        (module) => module.TeachersPage,
      ),
  },
  {
    path: 'admin',
    canActivate: [
      authGuard,
      passwordChangedGuard,
      roleGuard('SUPER_ADMIN'),
    ],
    loadComponent: () =>
      import('./features/admin/attendance/admin-dashboard-page').then(
        (module) => module.AdminDashboardPage,
      ),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
