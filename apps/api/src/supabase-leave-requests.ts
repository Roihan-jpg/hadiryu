import {
  AdminLeaveRequestSchema,
  CalendarExceptionSchema,
  LeaveRequestSchema,
  type AdminLeaveRequest,
  type CalendarException,
  type CreateLeaveRequest,
  type LeaveRequest,
  type ListAdminLeaveRequestsQuery,
  type ListLeaveRequestsQuery,
  type ScheduleRule,
  type ScheduleType,
  type SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import type { LeaveRequestRepository } from './leave-requests.js';
import type { StoredRequestAttachment } from './request-attachments.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';

const LeaveRowSchema = z.strictObject({
  id: z.uuid(), teacher_id: z.uuid(), leave_date: z.string(),
  leave_type: z.enum(['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER']),
  reason: z.string(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
  attachment_storage_path: z.string().nullable(), attachment_original_name: z.string().nullable(),
  attachment_mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']).nullable(),
  attachment_size_bytes: z.number().int().nullable(),
  decision_note: z.string().nullable(), decided_by: z.uuid().nullable(), decided_at: z.string().nullable(),
  created_at: z.string(), updated_at: z.string(),
});
const AdminLeaveRowSchema = LeaveRowSchema.extend({
  profiles: z.object({ nip: z.string(), full_name: z.string(), whatsapp_number: z.string().nullable() }).nullable(),
});
const CalendarRowSchema = z.strictObject({
  id: z.uuid(), work_date: z.string(), exception_type: z.enum(['HOLIDAY', 'WORKING_DAY']),
  name: z.string(), schedule_type: z.enum(['WEEKDAY', 'SATURDAY']).nullable(),
});
const ScheduleRowSchema = z.strictObject({
  id: z.uuid(), schedule_type: z.enum(['WEEKDAY', 'SATURDAY']), check_in_open: z.string(),
  work_start: z.string(), check_in_close: z.string(), checkout_open: z.string(), work_end: z.string(),
  checkout_close: z.string(), target_minutes: z.number().int(), effective_from: z.string(), effective_to: z.string().nullable(),
});
const LEAVE_FIELDS = 'id,teacher_id,leave_date,leave_type,reason,attachment_storage_path,attachment_original_name,attachment_mime_type,attachment_size_bytes,status,decision_note,decided_by,decided_at,created_at,updated_at';

function clientOptions() {
  return { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
}
function time(value: string): string { return value.slice(0, 5); }
function toLeave(value: unknown): LeaveRequest {
  const row = LeaveRowSchema.parse(value);
  return LeaveRequestSchema.parse({
    id: row.id, teacherId: row.teacher_id, leaveDate: row.leave_date, leaveType: row.leave_type,
    reason: row.reason,
    attachment: row.attachment_storage_path ? {
      originalName: row.attachment_original_name,
      mimeType: row.attachment_mime_type,
      sizeBytes: row.attachment_size_bytes,
    } : null,
    status: row.status, decisionNote: row.decision_note, decidedBy: row.decided_by,
    decidedAt: row.decided_at, createdAt: row.created_at, updatedAt: row.updated_at,
  });
}
function toAdminLeave(value: unknown): AdminLeaveRequest {
  const row = AdminLeaveRowSchema.parse(value);
  if (!row.profiles) throw new AppError(500, 'LEAVE_LOOKUP_FAILED', 'Profil Guru untuk izin tidak dapat dimuat');
  return AdminLeaveRequestSchema.parse({
    ...toLeave({
      id: row.id,
      teacher_id: row.teacher_id,
      leave_date: row.leave_date,
      leave_type: row.leave_type,
      reason: row.reason,
      attachment_storage_path: row.attachment_storage_path,
      attachment_original_name: row.attachment_original_name,
      attachment_mime_type: row.attachment_mime_type,
      attachment_size_bytes: row.attachment_size_bytes,
      status: row.status,
      decision_note: row.decision_note,
      decided_by: row.decided_by,
      decided_at: row.decided_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
    teacherNip: row.profiles.nip,
    teacherFullName: row.profiles.full_name,
    teacherWhatsappNumber: row.profiles.whatsapp_number,
  });
}
function toCalendar(value: unknown): CalendarException {
  const row = CalendarRowSchema.parse(value);
  return CalendarExceptionSchema.parse({
    id: row.id,
    workDate: row.work_date,
    exceptionType: row.exception_type,
    name: row.name,
    scheduleType: row.schedule_type,
  });
}
function toSchedule(value: unknown): ScheduleRule {
  const row = ScheduleRowSchema.parse(value);
  return {
    id: row.id, scheduleType: row.schedule_type, checkInOpen: time(row.check_in_open), workStart: time(row.work_start),
    checkInClose: time(row.check_in_close), checkoutOpen: time(row.checkout_open), workEnd: time(row.work_end),
    checkoutClose: time(row.checkout_close), targetMinutes: row.target_minutes, effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
  };
}
function databaseError(code: string, message: string): AppError { return new AppError(500, code, message); }

export class SupabaseLeaveRequestRepository implements LeaveRequestRepository {
  private readonly client: SupabaseClient;
  private readonly attendance: SupabaseAttendanceRepository;
  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
    this.attendance = new SupabaseAttendanceRepository(config);
  }

  findSecuritySchedules(workDate: string): Promise<SecurityScheduleSettingsResponse> {
    return this.attendance.findSecuritySchedules(workDate);
  }

  async findAttendance(teacherId: string, leaveDate: string): Promise<boolean> {
    const { data, error } = await this.client.from('attendance_records').select('id').eq('teacher_id', teacherId).eq('work_date', leaveDate).limit(1).maybeSingle();
    if (error) throw databaseError('LEAVE_LOOKUP_FAILED', 'Status absensi tidak dapat dimuat');
    return data !== null;
  }
  async findCalendarException(workDate: string): Promise<CalendarException | null> {
    const { data, error } = await this.client.from('calendar_exceptions').select('id,work_date,exception_type,name,schedule_type').eq('work_date', workDate).maybeSingle();
    if (error) throw databaseError('LEAVE_LOOKUP_FAILED', 'Kalender sekolah tidak dapat dimuat');
    return data ? toCalendar(data) : null;
  }
  async findSchedule(scheduleType: ScheduleType, workDate: string): Promise<ScheduleRule | null> {
    const { data, error } = await this.client.from('schedule_rules').select('id,schedule_type,check_in_open,work_start,check_in_close,checkout_open,work_end,checkout_close,target_minutes,effective_from,effective_to').eq('schedule_type', scheduleType).lte('effective_from', workDate).or(`effective_to.is.null,effective_to.gte.${workDate}`).order('effective_from', { ascending: false }).limit(1).maybeSingle();
    if (error) throw databaseError('LEAVE_LOOKUP_FAILED', 'Jadwal kerja tidak dapat dimuat');
    return data ? toSchedule(data) : null;
  }
  async create(teacherId: string, input: CreateLeaveRequest, attachment?: StoredRequestAttachment): Promise<LeaveRequest> {
    const { data, error } = await this.client.from('leave_requests').insert({
      teacher_id: teacherId,
      leave_date: input.leaveDate,
      leave_type: input.leaveType,
      reason: input.reason,
      status: 'PENDING',
      attachment_storage_path: attachment?.storagePath ?? null,
      attachment_original_name: attachment?.originalName ?? null,
      attachment_mime_type: attachment?.mimeType ?? null,
      attachment_size_bytes: attachment?.sizeBytes ?? null,
    }).select(LEAVE_FIELDS).single();
    if (!error && data) return toLeave(data);
    if (error?.code === '23505') throw new AppError(409, 'ACTIVE_LEAVE_EXISTS', 'Sudah ada izin aktif pada tanggal tersebut');
    if (error?.code === '23514' && error.message.includes('attendance_leave_conflict')) {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'Izin tidak dapat diproses karena Guru sudah check-in');
    }
    throw databaseError('LEAVE_SAVE_FAILED', 'Pengajuan izin tidak dapat disimpan');
  }
  async findOwn(teacherId: string, leaveRequestId: string): Promise<LeaveRequest | null> {
    const { data, error } = await this.client.from('leave_requests').select(LEAVE_FIELDS).eq('id', leaveRequestId).eq('teacher_id', teacherId).maybeSingle();
    if (error) throw databaseError('LEAVE_LOOKUP_FAILED', 'Pengajuan izin tidak dapat dimuat');
    return data ? toLeave(data) : null;
  }
  async cancel(teacherId: string, leaveRequestId: string): Promise<LeaveRequest> {
    const { data, error } = await this.client.from('leave_requests').update({ status: 'CANCELLED' }).eq('id', leaveRequestId).eq('teacher_id', teacherId).eq('status', 'PENDING').select(LEAVE_FIELDS).maybeSingle();
    if (!error && data) return toLeave(data);
    if (!error) throw new AppError(409, 'LEAVE_NOT_PENDING', 'Hanya izin Pending yang dapat dibatalkan');
    throw databaseError('LEAVE_SAVE_FAILED', 'Pembatalan izin tidak dapat disimpan');
  }
  async listOwn(teacherId: string, input: ListLeaveRequestsQuery) {
    const start = (input.page - 1) * input.pageSize;
    let query = this.client.from('leave_requests').select(LEAVE_FIELDS, { count: 'exact' }).eq('teacher_id', teacherId).order('leave_date', { ascending: false }).order('created_at', { ascending: false }).range(start, start + input.pageSize - 1);
    if (input.status) query = query.eq('status', input.status);
    const { data, error, count } = await query;
    if (error) throw databaseError('LEAVE_LIST_FAILED', 'Daftar izin tidak dapat dimuat');
    return { records: (data ?? []).map(toLeave), totalItems: count ?? 0 };
  }
  async findAny(leaveRequestId: string): Promise<AdminLeaveRequest | null> {
    const { data, error } = await this.client.from('leave_requests').select(`${LEAVE_FIELDS},profiles!leave_requests_teacher_id_fkey(nip,full_name,whatsapp_number)`).eq('id', leaveRequestId).maybeSingle();
    if (error) throw databaseError('LEAVE_LOOKUP_FAILED', 'Pengajuan izin tidak dapat dimuat');
    return data ? toAdminLeave(data) : null;
  }
  async listAdmin(input: ListAdminLeaveRequestsQuery) {
    const start = (input.page - 1) * input.pageSize;
    let query = this.client.from('leave_requests').select(`${LEAVE_FIELDS},profiles!leave_requests_teacher_id_fkey(nip,full_name,whatsapp_number)`, { count: 'exact' }).order('leave_date', { ascending: true }).order('created_at', { ascending: true }).range(start, start + input.pageSize - 1);
    if (input.status) query = query.eq('status', input.status);
    if (input.leaveDate) query = query.eq('leave_date', input.leaveDate);
    if (input.search) query = query.or(`nip.ilike.%${input.search}%,full_name.ilike.%${input.search}%`, { referencedTable: 'profiles' });
    const { data, error, count } = await query;
    if (error) throw databaseError('LEAVE_LIST_FAILED', 'Daftar approval izin tidak dapat dimuat');
    return { records: (data ?? []).map(toAdminLeave), totalItems: count ?? 0 };
  }
  async decide(leaveRequestId: string, actorId: string, status: 'APPROVED' | 'REJECTED', decisionNote: string | null, decidedAt: string): Promise<LeaveRequest> {
    const { data, error } = await this.client.from('leave_requests').update({ status, decision_note: decisionNote, decided_by: actorId, decided_at: decidedAt }).eq('id', leaveRequestId).eq('status', 'PENDING').select(LEAVE_FIELDS).maybeSingle();
    if (!error && data) return toLeave(data);
    if (!error) throw new AppError(409, 'LEAVE_NOT_PENDING', 'Hanya izin Pending yang dapat diputuskan');
    if (error.code === '23514' && error.message.includes('attendance_leave_conflict')) {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'Izin tidak dapat diproses karena Guru sudah check-in');
    }
    if (error.code === '42501' && error.message.includes('audit_logs')) {
      throw databaseError('LEAVE_AUDIT_FAILED', 'Audit keputusan izin tidak dapat disimpan');
    }
    throw databaseError('LEAVE_SAVE_FAILED', 'Keputusan izin tidak dapat disimpan');
  }
}
