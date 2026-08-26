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
import {
  registerAttendanceRoutes,
  type AttendanceService,
} from './attendance.js';
import {
  registerLeaveRequestRoutes,
  type LeaveRequestService,
} from './leave-requests.js';
import {
  registerAdminAttendanceRoutes,
  type AdminAttendanceService,
} from './admin-attendance.js';
import {
  registerMonthlyReportRoutes,
  type MonthlyReportService,
} from './monthly-report.js';

export interface CreateAppOptions {
  authService?: AuthService;
  attendanceService?: AttendanceService;
  settingsService?: SettingsService;
  teacherService?: TeacherService;
  leaveRequestService?: LeaveRequestService;
  adminAttendanceService?: AdminAttendanceService;
  monthlyReportService?: MonthlyReportService;
  secureCookies?: boolean;
}

const unavailableAttendanceService: AttendanceService = {
  async getToday() {
    throw new AppError(500, 'ATTENDANCE_NOT_CONFIGURED', 'Absensi belum dikonfigurasi');
  },
  async checkIn() {
    throw new AppError(500, 'ATTENDANCE_NOT_CONFIGURED', 'Absensi belum dikonfigurasi');
  },
  async checkout() {
    throw new AppError(500, 'ATTENDANCE_NOT_CONFIGURED', 'Absensi belum dikonfigurasi');
  },
  async history() {
    throw new AppError(500, 'ATTENDANCE_NOT_CONFIGURED', 'Absensi belum dikonfigurasi');
  },
};

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

const unavailableLeaveRequestService: LeaveRequestService = {
  async create() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async listOwn() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async cancel() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async listAdmin() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async approve() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async reject() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
};

const unavailableAdminAttendanceService: AdminAttendanceService = {
  async list() {
    throw new AppError(
      500,
      'ADMIN_ATTENDANCE_NOT_CONFIGURED',
      'Monitoring absensi belum dikonfigurasi',
    );
  },
  async addNote() {
    throw new AppError(
      500,
      'ADMIN_ATTENDANCE_NOT_CONFIGURED',
      'Monitoring absensi belum dikonfigurasi',
    );
  },
};

const unavailableMonthlyReportService: MonthlyReportService = {
  async preview() {
    throw new AppError(
      500,
      'MONTHLY_REPORT_NOT_CONFIGURED',
      'Laporan bulanan belum dikonfigurasi',
    );
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
  registerAttendanceRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.attendanceService ?? unavailableAttendanceService,
  );
  registerLeaveRequestRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.leaveRequestService ?? unavailableLeaveRequestService,
  );
  registerAdminAttendanceRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.adminAttendanceService ?? unavailableAdminAttendanceService,
  );
  registerMonthlyReportRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.monthlyReportService ?? unavailableMonthlyReportService,
  );
  app.use(authErrorHandler);

  return app;
}
