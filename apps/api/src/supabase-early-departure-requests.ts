import {
  AdminEarlyDepartureRequestSchema,
  EarlyDepartureRequestSchema,
  type AdminEarlyDepartureRequest,
  type EarlyDepartureRequest,
  type ListAdminEarlyDepartureRequestsQuery,
  type ListEarlyDepartureRequestsQuery,
  type AttendanceTimelineEvent,
} from '@absensi/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AppError } from './auth.js';
import type {
  EarlyDepartureRequestRepository,
  SaveEarlyDepartureRequestInput,
} from './early-departure-requests.js';
import { SupabaseAttendanceRepository } from './supabase-attendance.js';
import type { SupabaseAuthConfig } from './supabase-auth.js';

const NumericValueSchema = z.union([z.number(), z.string()]);
const EarlyDepartureRowSchema = z.strictObject({
  id: z.uuid(),
  attendance_id: z.uuid(),
  teacher_id: z.uuid(),
  work_date: z.string(),
  requested_at: z.string(),
  reason: z.string(),
  attachment_storage_path: z.string().nullable(),
  attachment_original_name: z.string().nullable(),
  attachment_mime_type: z.enum(['application/pdf', 'image/jpeg', 'image/png']).nullable(),
  attachment_size_bytes: z.number().int().nullable(),
  latitude: NumericValueSchema,
  longitude: NumericValueSchema,
  accuracy_meters: NumericValueSchema,
  distance_meters: NumericValueSchema,
  boundary_clearance_meters: NumericValueSchema.nullable(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  decision_note: z.string().nullable(),
  decided_by: z.uuid().nullable(),
  decided_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const AdminEarlyDepartureRowSchema = EarlyDepartureRowSchema.extend({
  profiles: z.object({ nip: z.string(), full_name: z.string(), whatsapp_number: z.string().nullable() }).nullable(),
});

const FIELDS =
  'id,attendance_id,teacher_id,work_date,requested_at,reason,attachment_storage_path,attachment_original_name,attachment_mime_type,attachment_size_bytes,latitude,longitude,accuracy_meters,distance_meters,boundary_clearance_meters,status,decision_note,decided_by,decided_at,created_at,updated_at';

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };
}

function toRequest(value: unknown): EarlyDepartureRequest {
  const row = EarlyDepartureRowSchema.parse(value);
  return EarlyDepartureRequestSchema.parse({
    id: row.id,
    attendanceId: row.attendance_id,
    teacherId: row.teacher_id,
    workDate: row.work_date,
    requestedAt: row.requested_at,
    reason: row.reason,
    attachment: row.attachment_storage_path ? {
      originalName: row.attachment_original_name,
      mimeType: row.attachment_mime_type,
      sizeBytes: row.attachment_size_bytes,
    } : null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracyMeters: Number(row.accuracy_meters),
    distanceMeters: Number(row.distance_meters),
    boundaryClearanceMeters: row.boundary_clearance_meters === null
      ? null
      : Number(row.boundary_clearance_meters),
    status: row.status,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toAdminRequest(value: unknown): AdminEarlyDepartureRequest {
  const row = AdminEarlyDepartureRowSchema.parse(value);
  if (!row.profiles) {
    throw new AppError(
      500,
      'EARLY_DEPARTURE_LOOKUP_FAILED',
      'Profil Guru untuk pulang awal tidak dapat dimuat',
    );
  }
  return AdminEarlyDepartureRequestSchema.parse({
    ...toRequest({
      id: row.id,
      attendance_id: row.attendance_id,
      teacher_id: row.teacher_id,
      work_date: row.work_date,
      requested_at: row.requested_at,
      reason: row.reason,
      attachment_storage_path: row.attachment_storage_path,
      attachment_original_name: row.attachment_original_name,
      attachment_mime_type: row.attachment_mime_type,
      attachment_size_bytes: row.attachment_size_bytes,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy_meters: row.accuracy_meters,
      distance_meters: row.distance_meters,
      boundary_clearance_meters: row.boundary_clearance_meters,
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

function databaseError(code: string, message: string): AppError {
  return new AppError(500, code, message);
}

export class SupabaseEarlyDepartureRequestRepository
  implements EarlyDepartureRequestRepository
{
  private readonly client: SupabaseClient;
  private readonly attendance: SupabaseAttendanceRepository;

  constructor(config: SupabaseAuthConfig) {
    this.client = createClient(config.url, config.secretKey, clientOptions());
    this.attendance = new SupabaseAttendanceRepository(config);
  }

  findAttendance(teacherId: string, workDate: string) {
    return this.attendance.findAttendance(teacherId, workDate);
  }

  findGeofence(workDate: string) {
    return this.attendance.findGeofence(workDate);
  }

  async create(
    teacherId: string,
    input: SaveEarlyDepartureRequestInput,
  ): Promise<EarlyDepartureRequest> {
    const { data, error } = await this.client.rpc(
      'create_early_departure_request_with_attachment',
      {
        p_teacher_id: teacherId,
        p_reason: input.reason,
        p_latitude: input.latitude,
        p_longitude: input.longitude,
        p_accuracy_meters: input.accuracyMeters,
        p_distance_meters: input.distanceMeters,
        p_boundary_clearance_meters: input.boundaryClearanceMeters,
        p_attachment_storage_path: input.attachment?.storagePath ?? null,
        p_attachment_original_name: input.attachment?.originalName ?? null,
        p_attachment_mime_type: input.attachment?.mimeType ?? null,
        p_attachment_size_bytes: input.attachment?.sizeBytes ?? null,
      },
    );
    if (!error && data) return toRequest(data);
    if (error?.code === '23505') {
      throw new AppError(
        409,
        'EARLY_DEPARTURE_EXISTS',
        'Permohonan pulang awal untuk absensi ini sudah ada',
      );
    }
    if (error?.message.includes('CHECK_IN_REQUIRED')) {
      throw new AppError(409, 'CHECK_IN_REQUIRED', 'Pulang awal memerlukan check-in');
    }
    if (error?.message.includes('ATTENDANCE_ALREADY_COMPLETED')) {
      throw new AppError(409, 'ATTENDANCE_ALREADY_COMPLETED', 'Absensi hari ini sudah selesai');
    }
    if (error?.message.includes('NOT_EARLY_DEPARTURE')) {
      throw new AppError(422, 'NOT_EARLY_DEPARTURE', 'Jam kerja sudah selesai');
    }
    throw databaseError(
      'EARLY_DEPARTURE_SAVE_FAILED',
      'Permohonan pulang awal tidak dapat disimpan',
    );
  }

  async findOwn(teacherId: string, requestId: string) {
    const { data, error } = await this.client
      .from('early_departure_requests')
      .select(FIELDS)
      .eq('id', requestId)
      .eq('teacher_id', teacherId)
      .maybeSingle();
    if (error) throw databaseError('EARLY_DEPARTURE_LOOKUP_FAILED', 'Permohonan pulang awal tidak dapat dimuat');
    return data ? toRequest(data) : null;
  }

  async listOwn(teacherId: string, input: ListEarlyDepartureRequestsQuery) {
    const start = (input.page - 1) * input.pageSize;
    let query = this.client
      .from('early_departure_requests')
      .select(FIELDS, { count: 'exact' })
      .eq('teacher_id', teacherId)
      .order('requested_at', { ascending: false })
      .range(start, start + input.pageSize - 1);
    if (input.status) query = query.eq('status', input.status);
    const { data, error, count } = await query;
    if (error) throw databaseError('EARLY_DEPARTURE_LIST_FAILED', 'Daftar pulang awal tidak dapat dimuat');
    return { records: (data ?? []).map(toRequest), totalItems: count ?? 0 };
  }

  async findAny(requestId: string) {
    const { data, error } = await this.client
      .from('early_departure_requests')
      .select(`${FIELDS},profiles!early_departure_requests_teacher_id_fkey(nip,full_name,whatsapp_number)`)
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw databaseError('EARLY_DEPARTURE_LOOKUP_FAILED', 'Permohonan pulang awal tidak dapat dimuat');
    return data ? toAdminRequest(data) : null;
  }

  async findTimeline(attendanceId: string): Promise<AttendanceTimelineEvent[]> {
    const { data, error } = await this.client
      .from('attendance_records')
      .select('check_in_at,check_out_at')
      .eq('id', attendanceId)
      .maybeSingle();
    if (error || !data) {
      throw databaseError('EARLY_DEPARTURE_LOOKUP_FAILED', 'Timeline absensi tidak dapat dimuat');
    }
    const events: AttendanceTimelineEvent[] = [{
      type: 'CHECK_IN',
      timestamp: data.check_in_at,
      label: 'Guru melakukan check-in',
    }];
    if (data.check_out_at) {
      events.push({ type: 'CHECKOUT', timestamp: data.check_out_at, label: 'Checkout pulang awal tercatat' });
    }
    return events;
  }

  async listAdmin(input: ListAdminEarlyDepartureRequestsQuery) {
    const start = (input.page - 1) * input.pageSize;
    let query = this.client
      .from('early_departure_requests')
      .select(`${FIELDS},profiles!early_departure_requests_teacher_id_fkey(nip,full_name,whatsapp_number)`, { count: 'exact' })
      .order('requested_at', { ascending: true })
      .range(start, start + input.pageSize - 1);
    if (input.status) query = query.eq('status', input.status);
    if (input.workDate) query = query.eq('work_date', input.workDate);
    if (input.search) {
      query = query.or(`nip.ilike.%${input.search}%,full_name.ilike.%${input.search}%`, { referencedTable: 'profiles' });
    }
    const { data, error, count } = await query;
    if (error) throw databaseError('EARLY_DEPARTURE_LIST_FAILED', 'Daftar approval pulang awal tidak dapat dimuat');
    return { records: (data ?? []).map(toAdminRequest), totalItems: count ?? 0 };
  }

  async decide(
    requestId: string,
    actorId: string,
    status: 'APPROVED' | 'REJECTED',
    decisionNote: string | null,
    decidedAt: string,
  ): Promise<EarlyDepartureRequest> {
    const { data, error } = await this.client
      .from('early_departure_requests')
      .update({
        status,
        decision_note: decisionNote,
        decided_by: actorId,
        decided_at: decidedAt,
      })
      .eq('id', requestId)
      .eq('status', 'PENDING')
      .select(FIELDS)
      .maybeSingle();
    if (!error && data) return toRequest(data);
    if (!error || error?.message.includes('EARLY_DEPARTURE_NOT_PENDING')) {
      throw new AppError(
        409,
        'EARLY_DEPARTURE_NOT_PENDING',
        'Hanya permohonan Pending yang dapat diputuskan',
      );
    }
    throw databaseError(
      'EARLY_DEPARTURE_SAVE_FAILED',
      'Keputusan pulang awal tidak dapat disimpan',
    );
  }
}
