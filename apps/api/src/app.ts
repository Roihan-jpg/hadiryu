import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { HealthResponse } from '@absensi/contracts';
import {
  AppError,
  createAuthErrorHandler,
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
  registerEarlyDepartureRequestRoutes,
  type EarlyDepartureRequestService,
} from './early-departure-requests.js';
import {
  registerAdminAttendanceRoutes,
  type AdminAttendanceService,
} from './admin-attendance.js';
import {
  registerMonthlyReportRoutes,
  type MonthlyReportService,
} from './monthly-report.js';
import {
  registerExcelExportRoutes,
  type ExcelExportService,
} from './excel-export.js';
import {
  createNotFoundHandler,
  createRequestObservabilityMiddleware,
  createStructuredLogger,
  silentLogger,
  type AppLogger,
} from './observability.js';
import {
  createCorsMiddleware,
  createCsrfProtectionMiddleware,
  createRateLimiter,
  createSecurityHeadersMiddleware,
  resolveSecurityConfig,
  type SecurityConfig,
} from './security.js';
import {
  registerRequestAttachmentRoutes,
  type SupabaseRequestAttachmentService,
} from './request-attachments.js';
import { registerAuditLogRoutes, type AuditLogService } from './audit-logs.js';
import { registerProfileRoutes, type ProfileService } from './profile.js';
import {
  registerSecurityDashboardRoutes,
  type SecurityDashboardService,
} from './security-dashboard.js';
import {
  registerRequestQuotaRoutes,
  type RequestQuotaService,
} from './request-quotas.js';
import { registerStaffDashboardRoutes, type StaffDashboardService } from './staff-dashboard.js';

export interface CreateAppOptions {
  authService?: AuthService;
  attendanceService?: AttendanceService;
  settingsService?: SettingsService;
  teacherService?: TeacherService;
  leaveRequestService?: LeaveRequestService;
  earlyDepartureRequestService?: EarlyDepartureRequestService;
  adminAttendanceService?: AdminAttendanceService;
  monthlyReportService?: MonthlyReportService;
  excelExportService?: ExcelExportService;
  requestAttachmentService?: SupabaseRequestAttachmentService;
  auditLogService?: AuditLogService;
  profileService?: ProfileService;
  securityDashboardService?: SecurityDashboardService;
  requestQuotaService?: RequestQuotaService;
  staffDashboardService?: StaffDashboardService;
  secureCookies?: boolean;
  logger?: AppLogger;
  security?: Partial<SecurityConfig>;
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
  async getReportingSettings() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan laporan belum dikonfigurasi');
  },
  async saveReportingSettings() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan laporan belum dikonfigurasi');
  },
  async getSchedules() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async saveSchedules() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async getSecuritySchedules() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan Satpam belum dikonfigurasi');
  },
  async saveSecuritySchedules() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan Satpam belum dikonfigurasi');
  },
  async getGeofence() {
    throw new AppError(500, 'SETTINGS_NOT_CONFIGURED', 'Pengaturan belum dikonfigurasi');
  },
  async saveGeofence() {
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
};

const unavailableLeaveRequestService: LeaveRequestService = {
  async create() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async listOwn() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async cancel() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async listAdmin() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async getAdmin() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async approve() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
  async reject() { throw new AppError(500, 'LEAVE_NOT_CONFIGURED', 'Izin belum dikonfigurasi'); },
};

const unavailableEarlyDepartureRequestService: EarlyDepartureRequestService = {
  async create() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
  async listOwn() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
  async listAdmin() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
  async getAdmin() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
  async approve() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
  async reject() { throw new AppError(500, 'EARLY_DEPARTURE_NOT_CONFIGURED', 'Pulang awal belum dikonfigurasi'); },
};

const unavailableAdminAttendanceService: AdminAttendanceService = {
  async dashboard() { throw new AppError(500, 'ADMIN_ATTENDANCE_NOT_CONFIGURED', 'Dashboard belum dikonfigurasi'); },
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
  async readiness() {
    throw new AppError(
      500,
      'MONTHLY_REPORT_NOT_CONFIGURED',
      'Laporan bulanan belum dikonfigurasi',
    );
  },
  async preview() {
    throw new AppError(
      500,
      'MONTHLY_REPORT_NOT_CONFIGURED',
      'Laporan bulanan belum dikonfigurasi',
    );
  },
};

const unavailableExcelExportService: ExcelExportService = {
  async export() {
    throw new AppError(
      500,
      'EXCEL_EXPORT_NOT_CONFIGURED',
      'Ekspor Excel belum dikonfigurasi',
    );
  },
};

const unavailableAuditLogService: AuditLogService = {
  async list() {
    throw new AppError(500, 'AUDIT_NOT_CONFIGURED', 'Audit log belum dikonfigurasi');
  },
};

const unavailableSecurityDashboardService: SecurityDashboardService = {
  async getDashboard() {
    throw new AppError(500, 'SECURITY_DASHBOARD_NOT_CONFIGURED', 'Dashboard Satpam belum dikonfigurasi');
  },
};

const unavailableRequestQuotaService: RequestQuotaService = {
  async get() {
    throw new AppError(500, 'REQUEST_QUOTA_NOT_CONFIGURED', 'Kuota permohonan belum dikonfigurasi');
  },
};

const unavailableStaffDashboardService: StaffDashboardService = {
  async get() { throw new AppError(500, 'DASHBOARD_NOT_CONFIGURED', 'Dashboard belum dikonfigurasi'); },
};

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const security = resolveSecurityConfig(options.security);
  const logger =
    options.logger ??
    (process.env['NODE_ENV'] === 'test' ? silentLogger : createStructuredLogger());

  app.disable('x-powered-by');
  if (security.trustProxy !== undefined) {
    app.set('trust proxy', security.trustProxy);
  }
  app.use(createRequestObservabilityMiddleware(logger));
  app.use(createSecurityHeadersMiddleware(security.production));
  if (
    !security.edgeValidatedOrigin &&
    (security.production || security.allowedOrigins.length > 0)
  ) {
    app.use(createCorsMiddleware(security.allowedOrigins));
  }
  app.use(createCsrfProtectionMiddleware(security.production));

  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  app.use(
    ['/api/auth/login', '/api/auth/refresh', '/api/auth/change-password'],
    createRateLimiter(security.authRateLimit),
  );
  app.use(
    [
      '/api/attendance/check-in',
      '/api/attendance/checkout',
      '/api/early-departure-requests',
    ],
    createRateLimiter(security.attendanceRateLimit),
  );

  app.get('/health', (_request, response) => {
    const body: HealthResponse = { status: 'ok' };

    response.status(200).json(body);
  });

  registerAuthRoutes(app, options.authService ?? unavailableAuthService, {
    ...(options.secureCookies === undefined
      ? {}
      : { secureCookies: options.secureCookies }),
  });
  if (options.profileService) {
    registerProfileRoutes(
      app,
      options.authService ?? unavailableAuthService,
      options.profileService,
    );
  }
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
  registerSecurityDashboardRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.securityDashboardService ?? unavailableSecurityDashboardService,
  );
  registerLeaveRequestRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.leaveRequestService ?? unavailableLeaveRequestService,
  );
  registerEarlyDepartureRequestRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.earlyDepartureRequestService ?? unavailableEarlyDepartureRequestService,
  );
  registerRequestQuotaRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.requestQuotaService ?? unavailableRequestQuotaService,
  );
  registerStaffDashboardRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.staffDashboardService ?? unavailableStaffDashboardService,
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
  registerExcelExportRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.excelExportService ?? unavailableExcelExportService,
  );
  if (options.requestAttachmentService) {
    registerRequestAttachmentRoutes(
      app,
      options.authService ?? unavailableAuthService,
      options.requestAttachmentService,
    );
  }
  registerAuditLogRoutes(
    app,
    options.authService ?? unavailableAuthService,
    options.auditLogService ?? unavailableAuditLogService,
  );
  app.use(createNotFoundHandler());
  app.use(createAuthErrorHandler(logger));

  return app;
}
