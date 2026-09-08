import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { createApp } from './app.js';
import {
  loadSupabaseAuthConfig,
  SupabaseAuthService,
} from './supabase-auth.js';
import { SupabaseTeacherService } from './supabase-teachers.js';
import { SupabaseSettingsService } from './supabase-settings.js';
import { createAttendanceService } from './attendance.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';
import { createLeaveRequestService } from './leave-requests.js';
import { SupabaseLeaveRequestRepository } from './supabase-leave-requests.js';
import { createEarlyDepartureRequestService } from './early-departure-requests.js';
import { SupabaseEarlyDepartureRequestRepository } from './supabase-early-departure-requests.js';
import { createAdminAttendanceService } from './admin-attendance.js';
import { SupabaseAdminAttendanceRepository } from './supabase-admin-attendance.js';
import { createMonthlyReportService } from './monthly-report.js';
import { SupabaseMonthlyReportRepository } from './supabase-monthly-report.js';
import { createExcelExportService } from './excel-export.js';
import { SupabaseExcelExportAuditRepository } from './supabase-excel-export.js';
import { createStructuredLogger } from './observability.js';
import { SupabaseRequestAttachmentService } from './request-attachments.js';
import { createAuditLogService } from './audit-logs.js';
import { SupabaseAuditLogRepository } from './supabase-audit-logs.js';
import { SupabaseProfileService } from './profile.js';
import { createSecurityDashboardService } from './security-dashboard.js';

function commaSeparated(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function trustProxy(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error('TRUST_PROXY_HOPS harus berupa bilangan bulat non-negatif');
  }
  return parsed;
}

const port = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const supabaseConfig = loadSupabaseAuthConfig(process.env);
const authService = new SupabaseAuthService(supabaseConfig);
const teacherService = new SupabaseTeacherService(supabaseConfig);
const settingsService = new SupabaseSettingsService(supabaseConfig);
const attendanceRepository = new SupabaseAttendanceRepository(supabaseConfig);
const attendanceService = createAttendanceService(attendanceRepository);
const securityDashboardService = createSecurityDashboardService(attendanceRepository);
const requestAttachmentService = new SupabaseRequestAttachmentService(supabaseConfig);
const auditLogService = createAuditLogService(new SupabaseAuditLogRepository(supabaseConfig));
const profileService = new SupabaseProfileService(supabaseConfig);
const leaveRequestService = createLeaveRequestService(
  new SupabaseLeaveRequestRepository(supabaseConfig),
  undefined,
  requestAttachmentService,
);
const earlyDepartureRequestService = createEarlyDepartureRequestService(
  new SupabaseEarlyDepartureRequestRepository(supabaseConfig),
  undefined,
  requestAttachmentService,
);
const adminAttendanceService = createAdminAttendanceService(
  new SupabaseAdminAttendanceRepository(supabaseConfig),
);
const monthlyReportService = createMonthlyReportService(
  new SupabaseMonthlyReportRepository(supabaseConfig),
);
const excelExportService = createExcelExportService(
  monthlyReportService,
  new SupabaseExcelExportAuditRepository(supabaseConfig),
  {
    loadTemplate: () => readFile(fileURLToPath(
      new URL('../../../report-template.xlsx', import.meta.url),
    )),
  },
);
const secureCookies =
  process.env['SESSION_COOKIE_SECURE'] === undefined
    ? process.env['NODE_ENV'] === 'production'
    : process.env['SESSION_COOKIE_SECURE'] === 'true';
const logger = createStructuredLogger();
const configuredTrustProxy = trustProxy(process.env['TRUST_PROXY_HOPS']);

createApp({
  adminAttendanceService,
  attendanceService,
  authService,
  settingsService,
  teacherService,
  leaveRequestService,
  earlyDepartureRequestService,
  monthlyReportService,
  excelExportService,
  requestAttachmentService,
  auditLogService,
  profileService,
  securityDashboardService,
  logger,
  secureCookies,
  security: {
    production: process.env['NODE_ENV'] === 'production',
    allowedOrigins: commaSeparated(process.env['CORS_ALLOWED_ORIGINS']),
    ...(configuredTrustProxy === undefined
      ? {}
      : { trustProxy: configuredTrustProxy }),
  },
}).listen(port, () => {
  logger.info({ event: 'api.started', port });
});
