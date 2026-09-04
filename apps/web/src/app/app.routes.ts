import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  passwordChangedGuard,
  roleGuard,
} from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'guru/pulang-awal',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('USER')],
    loadComponent: () =>
      import('./features/early-departure-requests/early-departure-requests-page').then(
        (module) => module.EarlyDepartureRequestsPage,
      ),
  },
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
    path: 'admin/early-departure-requests/:id',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () => import('./features/admin/early-departure-requests/admin-early-departure-request-detail-page').then((module) => module.AdminEarlyDepartureRequestDetailPage),
  },
  {
    path: 'admin/early-departure-requests',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () =>
      import('./features/admin/early-departure-requests/admin-early-departure-requests-page').then(
        (module) => module.AdminEarlyDepartureRequestsPage,
      ),
  },
  {
    path: 'admin/leave-requests/:id',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () => import('./features/admin/leave-requests/admin-leave-request-detail-page').then((module) => module.AdminLeaveRequestDetailPage),
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
    path: 'admin/reports',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () => import('./features/admin/reports/reports-page').then((module) => module.ReportsPage),
  },
  {
    path: 'admin/audit',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () => import('./features/admin/audit/audit-page').then((module) => module.AuditPage),
  },
  {
    path: 'admin/guide',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('SUPER_ADMIN')],
    loadComponent: () => import('./features/admin/guide/guide-page').then((module) => module.GuidePage),
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
