import {
  AttendanceAdminNoteSchema,
  CalendarExceptionSchema,
  type AttendanceAdminNote,
  type CalendarException,
  type CreateAttendanceAdminNote,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type {
  AdminAttendanceRepository,
  AdminAttendanceSource,
  AdminAttendanceSourceAttendance,
} from './admin-attendance.js';
import { AppError } from './auth.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';

const ProfileRowSchema = z.strictObject({
  id: z.uuid(),
  nip: z.string(),
  full_name: z.string(),
  role: z.enum(['USER', 'SECURITY_GUARD']),
});
const AttendanceRowSchema = z.strictObject({
  id: z.uuid(),
  teacher_id: z.uuid(),
  work_date: z.string(),
  check_in_at: z.string(),
  check_out_at: z.string().nullable(),
  checkout_close: z.string(),
  work_start: z.string(),
  work_end: z.string(),
  work_start_at: z.string(),
  work_end_at: z.string(),
  checkout_close_at: z.string(),
  target_minutes: z.number().int(),
  worked_minutes: z.number().int().nullable(),
  work_deficit_minutes: z.number().int().nullable(),
  arrival_late_minutes: z.number().int(),
  status: z.enum(['CHECKED_IN', 'COMPLETED']),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY', 'SECURITY_DAY', 'SECURITY_NIGHT']),
});
const LeaveRowSchema = z.strictObject({
  teacher_id: z.uuid(),
  leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL']),
});
const LatePermissionRowSchema = z.strictObject({
  teacher_id: z.uuid(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  created_at: z.string(),
});
const EarlyPermissionRowSchema = z.strictObject({
  attendance_id: z.uuid(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  created_at: z.string(),
});
const CalendarRowSchema = z.strictObject({
  id: z.uuid(),
  work_date: z.string(),
  exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  name: z.string(),
  schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
});
const NoteRowSchema = z.strictObject({
  id: z.uuid(),
  attendance_id: z.uuid(),
  note: z.string(),
  created_by: z.uuid(),
  created_at: z.string(),
  profiles: z.object({ full_name: z.string() }).nullable(),
});

const ATTENDANCE_FIELDS =
  'id,teacher_id,work_date,check_in_at,check_out_at,work_start,work_end,checkout_close,work_start_at,work_end_at,checkout_close_at,target_minutes,worked_minutes,work_deficit_minutes,arrival_late_minutes,status,schedule_type';
const NOTE_FIELDS =
  'id,attendance_id,note,created_by,created_at,profiles!attendance_admin_notes_created_by_fkey(full_name)';

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function time(value: string): string {
  return value.slice(0, 5);
}

function toAttendance(value: unknown): AdminAttendanceSourceAttendance {
  const row = AttendanceRowSchema.parse(value);
  return {
    id: row.id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    checkoutClose: time(row.checkout_close),
    workStart: time(row.work_start),
    workEnd: time(row.work_end),
    workStartAt: row.work_start_at,
    workEndAt: row.work_end_at,
    checkoutCloseAt: row.checkout_close_at,
    targetMinutes: row.target_minutes,
    workedMinutes: row.worked_minutes,
    workDeficitMinutes: row.work_deficit_minutes,
    arrivalLateMinutes: row.arrival_late_minutes,
    status: row.status,
    scheduleType: row.schedule_type,
  };
}

function toCalendarException(value: unknown): CalendarException {
  const row = CalendarRowSchema.parse(value);
  return CalendarExceptionSchema.parse({
    id: row.id,
    workDate: row.work_date,
    exceptionType: row.exception_type,
    name: row.name,
    scheduleType: row.schedule_type,
  });
}

function toNote(value: unknown): AttendanceAdminNote {
  const row = NoteRowSchema.parse(value);
  if (!row.profiles) {
    throw new AppError(
      500,
      'ATTENDANCE_NOTE_LOOKUP_FAILED',
      'Pembuat catatan admin tidak dapat dimuat',
    );
  }
  return AttendanceAdminNoteSchema.parse({
    id: row.id,
    attendanceId: row.attendance_id,
    note: row.note,
    createdBy: row.created_by,
    createdByFullName: row.profiles.full_name,
    createdAt: row.created_at,
  });
}

function databaseError(code: string, message: string): AppError {
  return new AppError(500, code, message);
}

export class SupabaseAdminAttendanceRepository
  implements AdminAttendanceRepository
{
  private readonly client: SupabaseClient;
  private readonly attendanceRepository: SupabaseAttendanceRepository;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
    this.attendanceRepository = new SupabaseAttendanceRepository(config);
  }

  async findSecuritySchedules(workDate: string) {
    return this.attendanceRepository.findSecuritySchedules(workDate);
  }

  async findCalendarException(
    workDate: string,
  ): Promise<CalendarException | null> {
    const { data, error } = await this.client
      .from('calendar_exceptions')
      .select('id,work_date,exception_type,name,schedule_type')
      .eq('work_date', workDate)
      .maybeSingle();
    if (error) {
      throw databaseError(
        'ADMIN_ATTENDANCE_LOOKUP_FAILED',
        'Kalender monitoring tidak dapat dimuat',
      );
    }
    return data ? toCalendarException(data) : null;
  }

  async listDailySources(
    workDate: string,
    search?: string,
  ): Promise<AdminAttendanceSource[]> {
    let profileQuery = this.client
      .from('profiles')
      .select('id,nip,full_name,role')
      .in('role', ['USER', 'SECURITY_GUARD'])
      .eq('is_active', true)
      .order('full_name', { ascending: true })
      .order('nip', { ascending: true });
    if (search) {
      profileQuery = profileQuery.or(
        `nip.ilike.%${search}%,full_name.ilike.%${search}%`,
      );
    }
    const { data: profileData, error: profileError } = await profileQuery;
    if (profileError) {
      throw databaseError(
        'ADMIN_ATTENDANCE_LOOKUP_FAILED',
        'Daftar Guru untuk monitoring tidak dapat dimuat',
      );
    }
    const profiles = (profileData ?? []).map((value) =>
      ProfileRowSchema.parse(value),
    );
    if (profiles.length === 0) return [];

    const teacherIds = profiles.map((profile) => profile.id);
    const [attendanceResult, leaveResult, lateResult, earlyResult] = await Promise.all([
      this.client
        .from('attendance_records')
        .select(ATTENDANCE_FIELDS)
        .eq('work_date', workDate)
        .in('teacher_id', teacherIds),
      this.client
        .from('leave_requests')
        .select('teacher_id,leave_type')
        .eq('leave_date', workDate)
        .eq('status', 'APPROVED')
        .neq('leave_type', 'LATE_ARRIVAL')
        .in('teacher_id', teacherIds),
      this.client
        .from('leave_requests')
        .select('teacher_id,status,created_at')
        .eq('leave_date', workDate)
        .eq('leave_type', 'LATE_ARRIVAL')
        .in('teacher_id', teacherIds)
        .order('created_at', { ascending: false }),
      this.client
        .from('early_departure_requests')
        .select('attendance_id,status,created_at')
        .eq('work_date', workDate)
        .in('teacher_id', teacherIds)
        .order('created_at', { ascending: false }),
    ]);
    if (attendanceResult.error || leaveResult.error || lateResult.error || earlyResult.error) {
      throw databaseError(
        'ADMIN_ATTENDANCE_LOOKUP_FAILED',
        'Data monitoring harian tidak dapat dimuat',
      );
    }
    const attendanceRows = (attendanceResult.data ?? []).map((value) =>
      AttendanceRowSchema.parse(value),
    );
    const leaveRows = (leaveResult.data ?? []).map((value) =>
      LeaveRowSchema.parse(value),
    );
    const lateRows = (lateResult.data ?? []).map((value) =>
      LatePermissionRowSchema.parse(value),
    );
    const earlyRows = (earlyResult.data ?? []).map((value) =>
      EarlyPermissionRowSchema.parse(value),
    );
    const attendanceIds = attendanceRows.map((row) => row.id);
    const noteRows = attendanceIds.length
      ? await this.client
          .from('attendance_admin_notes')
          .select(NOTE_FIELDS)
          .in('attendance_id', attendanceIds)
          .order('created_at', { ascending: true })
      : { data: [], error: null };
    if (noteRows.error) {
      throw databaseError(
        'ATTENDANCE_NOTE_LOOKUP_FAILED',
        'Catatan monitoring tidak dapat dimuat',
      );
    }

    const attendanceByTeacher = new Map(
      attendanceRows.map((row) => [row.teacher_id, row]),
    );
    const leaveByTeacher = new Map(
      leaveRows.map((row) => [row.teacher_id, row]),
    );
    const lateByTeacher = new Map<string, 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'>();
    for (const row of lateRows) {
      if (!lateByTeacher.has(row.teacher_id)) lateByTeacher.set(row.teacher_id, row.status);
    }
    const earlyByAttendance = new Map<string, 'PENDING' | 'APPROVED' | 'REJECTED'>();
    for (const row of earlyRows) {
      if (!earlyByAttendance.has(row.attendance_id)) earlyByAttendance.set(row.attendance_id, row.status);
    }
    const notesByAttendance = new Map<string, AttendanceAdminNote[]>();
    for (const value of noteRows.data ?? []) {
      const parsed = toNote(value);
      const notes = notesByAttendance.get(parsed.attendanceId) ?? [];
      notes.push(parsed);
      notesByAttendance.set(parsed.attendanceId, notes);
    }

    return profiles.map((profile) => {
      const attendanceRow = attendanceByTeacher.get(profile.id);
      const leaveRow = leaveByTeacher.get(profile.id);
      return {
        teacherId: profile.id,
        teacherNip: profile.nip,
        teacherFullName: profile.full_name,
        role: profile.role,
        attendance: attendanceRow
          ? {
              ...toAttendance(attendanceRow),
              lateArrivalStatus: lateByTeacher.get(profile.id) ?? null,
              earlyDepartureStatus: earlyByAttendance.get(attendanceRow.id) ?? null,
            }
          : null,
        approvedLeave: leaveRow ? { leaveType: leaveRow.leave_type } : null,
        notes: attendanceRow
          ? (notesByAttendance.get(attendanceRow.id) ?? [])
          : [],
      };
    });
  }

  async attendanceExists(attendanceId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('attendance_records')
      .select('id')
      .eq('id', attendanceId)
      .maybeSingle();
    if (error) {
      throw databaseError(
        'ADMIN_ATTENDANCE_LOOKUP_FAILED',
        'Data absensi tidak dapat dimuat',
      );
    }
    return data !== null;
  }

  async createNote(
    attendanceId: string,
    createdBy: string,
    input: CreateAttendanceAdminNote,
  ): Promise<AttendanceAdminNote> {
    const { data, error } = await this.client
      .from('attendance_admin_notes')
      .insert({
        attendance_id: attendanceId,
        note: input.note,
        created_by: createdBy,
      })
      .select(NOTE_FIELDS)
      .single();
    if (!error && data) return toNote(data);
    if (error?.code === '42501' && error.message.includes('audit_logs')) {
      throw databaseError(
        'ATTENDANCE_NOTE_AUDIT_FAILED',
        'Audit catatan admin tidak dapat disimpan',
      );
    }
    throw databaseError(
      'ATTENDANCE_NOTE_SAVE_FAILED',
      'Catatan admin tidak dapat disimpan',
    );
  }
}
