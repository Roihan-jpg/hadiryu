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
import { createAdminAttendanceService } from './admin-attendance.js';
import { SupabaseAdminAttendanceRepository } from './supabase-admin-attendance.js';

const port = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const supabaseConfig = loadSupabaseAuthConfig(process.env);
const authService = new SupabaseAuthService(supabaseConfig);
const teacherService = new SupabaseTeacherService(supabaseConfig);
const settingsService = new SupabaseSettingsService(supabaseConfig);
const attendanceService = createAttendanceService(
  new SupabaseAttendanceRepository(supabaseConfig),
);
const leaveRequestService = createLeaveRequestService(
  new SupabaseLeaveRequestRepository(supabaseConfig),
);
const adminAttendanceService = createAdminAttendanceService(
  new SupabaseAdminAttendanceRepository(supabaseConfig),
);
const secureCookies =
  process.env['SESSION_COOKIE_SECURE'] === undefined
    ? process.env['NODE_ENV'] === 'production'
    : process.env['SESSION_COOKIE_SECURE'] === 'true';

createApp({
  adminAttendanceService,
  attendanceService,
  authService,
  settingsService,
  teacherService,
  leaveRequestService,
  secureCookies,
}).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
