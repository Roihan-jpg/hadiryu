import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { HealthResponse } from '@absensi/contracts';
import {
  AppError,
  authErrorHandler,
  registerAuthRoutes,
  type AuthService,
} from './auth.js';

export interface CreateAppOptions {
  authService?: AuthService;
  secureCookies?: boolean;
}

const unavailableAuthService: AuthService = {
  async login() {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Auth belum dikonfigurasi');
  },
  async refresh() {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Auth belum dikonfigurasi');
  },
  async authenticate() {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Auth belum dikonfigurasi');
  },
  async changePassword() {
    throw new AppError(500, 'AUTH_NOT_CONFIGURED', 'Auth belum dikonfigurasi');
  },
  async logout() {},
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.get('/health', (_request, response) => {
    const body: HealthResponse = { status: 'ok' };

    response.status(200).json(body);
  });

  registerAuthRoutes(app, options.authService ?? unavailableAuthService, {
    ...(options.secureCookies === undefined
      ? {}
      : { secureCookies: options.secureCookies }),
  });
  app.use(authErrorHandler);

  return app;
}
