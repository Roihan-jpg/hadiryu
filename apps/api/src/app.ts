import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { HealthResponse } from '@absensi/contracts';
import {
  AppError,
  authErrorHandler,
  registerAuthRoutes,
  type AuthService,
} from './auth.js';
import { registerTeacherRoutes, type TeacherService } from './teachers.js';
import {
  registerSettingsRoutes,
  type SettingsService,
} from './schedule-geofence.js';

export interface CreateAppOptions {
  authService?: AuthService;
  settingsService?: SettingsService;
  teacherService?: TeacherService;
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

const unavailableTeacherService: TeacherService = {
  async list() {
    throw new AppError(500, 'TEACHERS_NOT_CONFIGURED', 'Master Guru belum dikonfigurasi');
  },
  async create() {
    throw new AppError(500, 'TEACHERS_NOT_CONFIGURED', 'Master Guru belum dikonfigurasi');
  },
  async update() {
    throw new AppError(500, 'TEACHERS_NOT_CONFIGURED', 'Master Guru belum dikonfigurasi');
  },
  async setActive() {
    throw new AppError(500, 'TEACHERS_NOT_CONFIGURED', 'Master Guru belum dikonfigurasi');
  },
  async resetPassword() {
    throw new AppError(500, 'TEACHERS_NOT_CONFIGURED', 'Master Guru belum dikonfigurasi');
  },
};

const unavailableSettingsService: SettingsService = {
  async getSchedules() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async createScheduleVersion() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async getGeofence() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async createGeofenceVersion() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async listCalendarExceptions() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async createCalendarException() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async updateCalendarException() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async deleteCalendarException() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async getPayroll() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async createPayrollVersion() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
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
  registerTeacherRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.teacherService ?? unavailableTeacherService,
  );
  registerSettingsRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.settingsService ?? unavailableSettingsService,
  );
  app.use(authErrorHandler);

  return app;
}
