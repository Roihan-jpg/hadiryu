import { Routes } from '@angular/router';
import {
  authGuard,
  guestGuard,
  passwordChangedGuard,
  roleGuard,
} from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login-page').then((module) => module.LoginPage),
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
    path: 'guru',
    canActivate: [authGuard, passwordChangedGuard, roleGuard('USER')],
    loadComponent: () =>
      import('./features/home/home-page').then((module) => module.HomePage),
  },
  {
    path: 'admin',
    canActivate: [
      authGuard,
      passwordChangedGuard,
      roleGuard('SUPER_ADMIN'),
    ],
    loadComponent: () =>
      import('./features/home/home-page').then((module) => module.HomePage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
