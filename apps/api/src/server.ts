import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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
import { createRequestQuotaService } from './request-quotas.js';
import { SupabaseRequestQuotaRepository } from './supabase-request-quotas.js';
import { createStaffDashboardService } from './staff-dashboard.js';
import { SupabaseStaffDashboardRepository } from './supabase-staff-dashboard.js';
import { FaceTemplateCipher } from './face-template.js';
import { PrivateFaceInferenceClient } from './face-inference-client.js';
import { SupabaseFaceEnrollmentService } from './supabase-face-enrollment.js';
import { SupabaseSimpleFaceService } from './simple-face.js';

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
const simpleFaceEnabled=process.env['FACE_VERIFICATION_MODE']==='SIMPLE_LOCAL';
const faceEnabled=process.env['FACE_ENROLLMENT_LOCAL']==='true'||simpleFaceEnabled;
if(faceEnabled && (process.env['NODE_ENV']==='production' || !['localhost','127.0.0.1'].includes(new URL(supabaseConfig.url).hostname)))
  throw new Error('Face enrollment is local evaluation only');
const teacherService = new SupabaseTeacherService(supabaseConfig,faceEnabled);
const templateKey=faceEnabled?await readFile(process.env['FACE_TEMPLATE_KEY_FILE']!):undefined;
const faceInference = faceEnabled ? new PrivateFaceInferenceClient(process.env['FACE_INFERENCE_ORIGIN']!,{
    ca:await readFile(process.env['FACE_TLS_CA']!),cert:await readFile(process.env['FACE_TLS_CERT']!),key:await readFile(process.env['FACE_TLS_KEY']!),
  },process.env['FACE_MODEL_VERSION']!) : undefined;
const faceCipher=faceEnabled?new FaceTemplateCipher('local-'+createHash('sha256').update(templateKey!).digest('hex').slice(0,24),templateKey!):undefined;
const faceEnrollmentService=faceEnabled&&!simpleFaceEnabled?new SupabaseFaceEnrollmentService(supabaseConfig,process.env['FACE_MODEL_VERSION']!,faceInference!,faceCipher!):undefined;
const simpleFaceService=simpleFaceEnabled?new SupabaseSimpleFaceService(supabaseConfig,process.env['FACE_MODEL_VERSION']!,faceInference!,faceCipher!):undefined;
const settingsService = new SupabaseSettingsService(supabaseConfig);
const attendanceRepository = new SupabaseAttendanceRepository(supabaseConfig);
const attendanceService = createAttendanceService(attendanceRepository);
const securityDashboardService = createSecurityDashboardService(attendanceRepository);
const requestQuotaService = createRequestQuotaService(
  new SupabaseRequestQuotaRepository(supabaseConfig),
);
const staffDashboardService = createStaffDashboardService({
  repository: new SupabaseStaffDashboardRepository(supabaseConfig),
  attendanceService,
  requestQuotaService,
  securityDashboardService,
});
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
  ...(faceEnrollmentService ? {faceEnrollmentService}:{}),
  ...(simpleFaceService ? {simpleFaceService}:{}),
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
  requestQuotaService,
  staffDashboardService,
  logger,
  secureCookies,
  security: {
    production: process.env['NODE_ENV'] === 'production',
    allowedOrigins: commaSeparated(process.env['CORS_ALLOWED_ORIGINS']),
    ...(configuredTrustProxy === undefined
      ? {}
      : { trustProxy: configuredTrustProxy }),
  },
}).listen(port, faceEnabled?'127.0.0.1':'0.0.0.0', () => {
  logger.info({ event: 'api.started', port });
});
