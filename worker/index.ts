import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';

import { createApp } from '../apps/api/src/app.js';
import { createAdminAttendanceService } from '../apps/api/src/admin-attendance.js';
import { createAttendanceService } from '../apps/api/src/attendance.js';
import { createAuditLogService } from '../apps/api/src/audit-logs.js';
import { createEarlyDepartureRequestService } from '../apps/api/src/early-departure-requests.js';
import { createExcelExportService } from '../apps/api/src/excel-export.js';
import { createLeaveRequestService } from '../apps/api/src/leave-requests.js';
import { createMonthlyReportService } from '../apps/api/src/monthly-report.js';
import { createStructuredLogger } from '../apps/api/src/observability.js';
import { SupabaseProfileService } from '../apps/api/src/profile.js';
import { SupabaseRequestAttachmentService } from '../apps/api/src/request-attachments.js';
import { SupabaseAdminAttendanceRepository } from '../apps/api/src/supabase-admin-attendance.js';
import { SupabaseAttendanceRepository } from '../apps/api/src/supabase-attendance.js';
import { SupabaseAuditLogRepository } from '../apps/api/src/supabase-audit-logs.js';
import { SupabaseAuthService, type SupabaseAuthConfig } from '../apps/api/src/supabase-auth.js';
import { SupabaseEarlyDepartureRequestRepository } from '../apps/api/src/supabase-early-departure-requests.js';
import { SupabaseExcelExportAuditRepository } from '../apps/api/src/supabase-excel-export.js';
import { SupabaseLeaveRequestRepository } from '../apps/api/src/supabase-leave-requests.js';
import { SupabaseMonthlyReportRepository } from '../apps/api/src/supabase-monthly-report.js';
import { SupabaseSettingsService } from '../apps/api/src/supabase-settings.js';
import { SupabaseTeacherService } from '../apps/api/src/supabase-teachers.js';
import reportTemplate from '../report-template.xlsx';
import { hasForeignOrigin, isApiRequest, normalizeSameOriginRequest } from './routing.js';

interface WorkerBindings {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

const publicOrigin = 'https://absensi-guru.roihanboizz2006.workers.dev';

const bindings = env as unknown as WorkerBindings;
const supabaseConfig: SupabaseAuthConfig = {
  url: bindings.SUPABASE_URL,
  publishableKey: 'server-only',
  secretKey: bindings.SUPABASE_SECRET_KEY,
};
const authService = new SupabaseAuthService(supabaseConfig);
const teacherService = new SupabaseTeacherService(supabaseConfig);
const settingsService = new SupabaseSettingsService(supabaseConfig);
const attendanceService = createAttendanceService(new SupabaseAttendanceRepository(supabaseConfig));
const requestAttachmentService = new SupabaseRequestAttachmentService(supabaseConfig);
const auditLogService = createAuditLogService(new SupabaseAuditLogRepository(supabaseConfig));
const leaveRequestService = createLeaveRequestService(
  new SupabaseLeaveRequestRepository(supabaseConfig), undefined, requestAttachmentService,
);
const earlyDepartureRequestService = createEarlyDepartureRequestService(
  new SupabaseEarlyDepartureRequestRepository(supabaseConfig), undefined, requestAttachmentService,
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
  { loadTemplate: async () => new Uint8Array(reportTemplate) },
);

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
  profileService: new SupabaseProfileService(supabaseConfig),
  logger: createStructuredLogger(),
  secureCookies: true,
  security: {
    production: true,
    edgeValidatedOrigin: true,
    allowedOrigins: [],
  },
}).listen(3000);

const apiHandler = httpServerHandler({ port: 3000 });

export default {
  async fetch(request, workerEnv, context) {
    const pathname = new URL(request.url).pathname;
    if (isApiRequest(pathname)) {
      if (hasForeignOrigin(request, [publicOrigin])) {
        return Response.json({
          error: { code: 'CORS_ORIGIN_FORBIDDEN', message: 'Origin request tidak diizinkan' },
        }, { status: 403 });
      }
      if (!apiHandler.fetch) return new Response('API handler unavailable', { status: 503 });
      return apiHandler.fetch(normalizeSameOriginRequest(request), workerEnv, context);
    }
    return workerEnv.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerBindings>;
