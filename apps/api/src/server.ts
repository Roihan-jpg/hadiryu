import { createApp } from './app.js';
import {
  loadSupabaseAuthConfig,
  SupabaseAuthService,
} from './supabase-auth.js';
import { SupabaseTeacherService } from './supabase-teachers.js';
import { SupabaseSettingsService } from './supabase-settings.js';
import { createAttendanceService } from './attendance.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';

const port = Number.parseInt(process.env['API_PORT'] ?? '3000', 10);
const supabaseConfig = loadSupabaseAuthConfig(process.env);
const authService = new SupabaseAuthService(supabaseConfig);
const teacherService = new SupabaseTeacherService(supabaseConfig);
const settingsService = new SupabaseSettingsService(supabaseConfig);
const attendanceService = createAttendanceService(
  new SupabaseAttendanceRepository(supabaseConfig),
);
const secureCookies =
  process.env['SESSION_COOKIE_SECURE'] === undefined
    ? process.env['NODE_ENV'] === 'production'
    : process.env['SESSION_COOKIE_SECURE'] === 'true';

createApp({
  attendanceService,
  authService,
  settingsService,
  teacherService,
  secureCookies,
}).listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
