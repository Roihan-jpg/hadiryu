import {
  AdminLeaveRequestListResponseSchema,
  AdminLeaveRequestDetailResponseSchema,
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveRequestListResponseSchema,
  ListAdminLeaveRequestsQuerySchema,
  ListLeaveRequestsQuerySchema,
  type AdminLeaveRequest,
  type AdminLeaveRequestListResponse,
  type AuthUser,
  type CalendarException,
  type CreateLeaveRequest,
  type DecideLeaveRequest,
  type LeaveRequest,
  type LeaveRequestListResponse,
  type ListAdminLeaveRequestsQuery,
  type ListLeaveRequestsQuery,
  type ScheduleRule,
  type ScheduleType,
  type SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import type { Express, Request } from 'express';
import { z } from 'zod';

import { AppError, createSessionGuard, requireRole, type AuthService } from './auth.js';
import { resolveCalendarDay } from './calendar-payroll.js';
import { addLocalDays, buildSecurityShiftBoundaries, resolveSecurityAssignment } from './security-duty.js';
import {
  multipartPayload,
  parseOptionalAttachment,
  validateUploadedAttachment,
  type RequestAttachmentStorage,
  type StoredRequestAttachment,
  type UploadedRequestAttachment,
} from './request-attachments.js';
import { maternityLeavePeriods } from './maternity-leave.js';
import { OperationalAction, type OperationalLeaveBlock } from './operational-leave-block.js';

const JAKARTA_TIME_ZONE = 'Asia/Jakarta';
const LeaveRequestIdSchema = z.uuid();

export interface LeaveRequestRepository {
  findAttendance(teacherId: string, leaveDate: string): Promise<boolean>;
  findCalendarException(workDate: string): Promise<CalendarException | null>;
  findSchedule(scheduleType: ScheduleType, workDate: string): Promise<ScheduleRule | null>;
  findSecuritySchedules?(workDate: string): Promise<SecurityScheduleSettingsResponse>;
  findOperationalLeaveBlock?(teacherId: string, workDate: string): Promise<OperationalLeaveBlock | null>;
  create(
    teacherId: string,
    input: ResolvedLeaveRequestInput,
    attachment?: StoredRequestAttachment,
  ): Promise<LeaveRequest>;
  findOwn(teacherId: string, leaveRequestId: string): Promise<LeaveRequest | null>;
  cancel(teacherId: string, leaveRequestId: string): Promise<LeaveRequest>;
  listOwn(
    teacherId: string,
    input: ListLeaveRequestsQuery,
  ): Promise<{ records: LeaveRequest[]; totalItems: number }>;
  findAny(leaveRequestId: string): Promise<AdminLeaveRequest | null>;
  listAdmin(
    input: ListAdminLeaveRequestsQuery,
  ): Promise<{ records: AdminLeaveRequest[]; totalItems: number }>;
  decide(
    leaveRequestId: string,
    actorId: string,
    status: 'APPROVED' | 'REJECTED',
    decisionNote: string | null,
    decidedAt: string,
  ): Promise<LeaveRequest>;
}

export interface ResolvedLeaveRequestInput {
  leaveDate: string;
  leaveType: CreateLeaveRequest['leaveType'];
  reason: string;
  fullLeaveEndDate?: string;
  earlyDepartureStartDate?: string;
  earlyDepartureEndDate?: string;
}

export interface LeaveRequestService {
  create(
    teacher: string | Pick<AuthUser, 'id' | 'role' | 'gender'>,
    input: CreateLeaveRequest,
    attachment?: UploadedRequestAttachment,
  ): Promise<LeaveRequest>;
  listOwn(
    teacherId: string,
    input: ListLeaveRequestsQuery,
  ): Promise<LeaveRequestListResponse>;
  cancel(teacherId: string, leaveRequestId: string): Promise<LeaveRequest>;
  listAdmin(input: ListAdminLeaveRequestsQuery): Promise<AdminLeaveRequestListResponse>;
  getAdmin(leaveRequestId: string): Promise<AdminLeaveRequest>;
  approve(
    actorId: string,
    leaveRequestId: string,
    input: DecideLeaveRequest,
  ): Promise<LeaveRequest>;
  reject(
    actorId: string,
    leaveRequestId: string,
    input: DecideLeaveRequest,
  ): Promise<LeaveRequest>;
}

function jakartaDateTime(value: Date): { workDate: string; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return {
    workDate: `${part('year')}-${part('month')}-${part('day')}`,
    minuteOfDay: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

function timeMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function userId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

function staffUser(request: Request): AuthUser {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user;
}

function leaveRequestId(value: unknown): string {
  const parsed = LeaveRequestIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'ID izin tidak valid');
  return parsed.data;
}

function validationError(message: string, details: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

function paginated<T>(records: T[], totalItems: number, page: number, pageSize: number) {
  return { data: records, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
}

async function assertLeaveCreationAllowed(
  repository: LeaveRequestRepository,
  teacherId: string,
  workDate: string,
): Promise<void> {
  const block = await repository.findOperationalLeaveBlock?.(teacherId, workDate) ?? null;
  if (!block?.blockedActions.includes(OperationalAction.CREATE_LEAVE)) return;
  throw new AppError(409, 'OPERATION_BLOCKED_BY_LEAVE', 'Pengajuan izin tidak tersedia selama izin aktif', {
    leaveType: block.leaveType, status: block.status, phase: block.phase,
  });
}

export function calculateApprovedLeaveCredit(targetMinutes: number): {
  workedMinutes: number;
  workDeficitMinutes: 0;
} {
  return { workedMinutes: targetMinutes, workDeficitMinutes: 0 };
}

export function createLeaveRequestService(
  repository: LeaveRequestRepository,
  now: () => Date = () => new Date(),
  attachmentStorage?: RequestAttachmentStorage,
): LeaveRequestService {
  async function assertNoCheckIn(teacherId: string, leaveDate: string): Promise<void> {
    if (await repository.findAttendance(teacherId, leaveDate)) {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'Izin tidak dapat diproses karena Guru sudah check-in');
    }
  }

  async function decide(
    actorId: string,
    leaveRequestId: string,
    input: DecideLeaveRequest,
    status: 'APPROVED' | 'REJECTED',
  ): Promise<LeaveRequest> {
    const request = await repository.findAny(leaveRequestId);
    if (!request) throw new AppError(404, 'LEAVE_REQUEST_NOT_FOUND', 'Pengajuan izin tidak ditemukan');
    if (request.status !== 'PENDING') {
      throw new AppError(409, 'LEAVE_NOT_PENDING', 'Hanya izin Pending yang dapat diputuskan');
    }
    if (status === 'APPROVED' && request.leaveType !== 'LATE_ARRIVAL' && request.leaveType !== 'MATERNITY_LEAVE') {
      await assertNoCheckIn(request.teacherId, request.leaveDate);
    }
    return repository.decide(
      leaveRequestId, actorId, status, input.decisionNote ?? null, now().toISOString(),
    );
  }

  return {
    async create(teacherValue, rawInput, attachment) {
      const teacher = typeof teacherValue === 'string'
        ? { id: teacherValue, role: 'USER' as const }
        : teacherValue;
      const teacherId = teacher.id;
      const input = CreateLeaveRequestSchema.parse(rawInput);
      const serverNow = now();
      const current = jakartaDateTime(serverNow);
      await assertLeaveCreationAllowed(repository, teacherId, current.workDate);
      if (input.leaveType === 'MATERNITY_LEAVE') {
        if (teacher.role !== 'USER' || teacher.gender !== 'FEMALE') {
          throw new AppError(403, 'MATERNITY_LEAVE_FORBIDDEN', 'Cuti Melahirkan hanya tersedia untuk Guru Perempuan');
        }
        await assertNoCheckIn(teacherId, current.workDate);
        const exception = await repository.findCalendarException(current.workDate);
        const day = resolveCalendarDay(current.workDate, exception);
        const schedule = day.scheduleType
          ? await repository.findSchedule(day.scheduleType, current.workDate)
          : null;
        if (!schedule || current.minuteOfDay > timeMinutes(schedule.workEnd)) {
          throw new AppError(422, 'LEAVE_REQUEST_DEADLINE_PASSED', 'Izin hari ini hanya dapat diajukan sampai jam kerja selesai');
        }
        const periods = maternityLeavePeriods(current.workDate);
        const resolved: ResolvedLeaveRequestInput = {
          leaveDate: current.workDate,
          leaveType: input.leaveType,
          reason: input.reason,
          fullLeaveEndDate: periods.fullLeaveEndDate,
          earlyDepartureStartDate: periods.earlyDepartureStartDate,
          earlyDepartureEndDate: periods.earlyDepartureEndDate,
        };
        let storedAttachment: StoredRequestAttachment | undefined;
        try {
          if (attachment) {
            if (!attachmentStorage) throw new AppError(500, 'ATTACHMENT_NOT_CONFIGURED', 'Penyimpanan lampiran belum dikonfigurasi');
            storedAttachment = await attachmentStorage.upload(teacherId, 'leave', attachment);
          }
          return await repository.create(teacherId, resolved, storedAttachment);
        } catch (error) {
          if (storedAttachment && attachmentStorage) await attachmentStorage.remove(storedAttachment.storagePath);
          throw error;
        }
      }
      if (
        input.leaveDate < current.workDate &&
        (teacher.role !== 'SECURITY_GUARD' || input.leaveDate < addLocalDays(current.workDate, -1))
      ) {
        throw new AppError(422, 'LEAVE_DATE_IN_PAST', 'Izin tidak dapat diajukan untuk tanggal yang sudah lewat');
      }
      await assertNoCheckIn(teacherId, input.leaveDate);
      if (teacher.role === 'SECURITY_GUARD') {
        const settings = await repository.findSecuritySchedules?.(input.leaveDate);
        if (!settings?.roster || !settings.dayShift || !settings.nightShift) {
          throw new AppError(422, 'SECURITY_SCHEDULE_NOT_CONFIGURED', 'Jadwal Satpam belum dikonfigurasi');
        }
        const assignment = resolveSecurityAssignment(settings.roster, input.leaveDate, teacherId);
        if (assignment.status === 'OFF' || assignment.status === 'UNASSIGNED') {
          throw new AppError(422, 'LEAVE_NOT_ALLOWED_ON_OFF_DAY', 'Izin tidak dapat diajukan pada Libur Rotasi');
        }
        if (input.leaveDate < current.workDate && assignment.status !== 'NIGHT') {
          throw new AppError(422, 'LEAVE_DATE_IN_PAST', 'Izin tidak dapat diajukan untuk tanggal yang sudah lewat');
        }
        if (input.leaveDate <= current.workDate) {
          const schedule = assignment.status === 'DAY' ? settings.dayShift : settings.nightShift;
          const boundaries = buildSecurityShiftBoundaries(
            input.leaveDate,
            schedule,
            schedule.scheduleType as 'SECURITY_DAY' | 'SECURITY_NIGHT',
          );
          const deadlineAt = input.leaveType === 'LATE_ARRIVAL'
            ? boundaries.checkInCloseAt
            : boundaries.workEndAt;
          if (serverNow.getTime() > new Date(deadlineAt).getTime()) {
            throw new AppError(
              422,
              input.leaveType === 'LATE_ARRIVAL'
                ? 'LATE_ARRIVAL_REQUEST_DEADLINE_PASSED'
                : 'LEAVE_REQUEST_DEADLINE_PASSED',
              input.leaveType === 'LATE_ARRIVAL'
                ? 'Izin terlambat hanya dapat diajukan sampai batas check-in'
                : 'Izin hari ini hanya dapat diajukan sampai jam kerja selesai',
            );
          }
        }
      } else if (input.leaveDate === current.workDate) {
        const exception = await repository.findCalendarException(input.leaveDate);
        const day = resolveCalendarDay(input.leaveDate, exception);
        const schedule = day.scheduleType
          ? await repository.findSchedule(day.scheduleType, input.leaveDate)
          : null;
        const deadline = input.leaveType === 'LATE_ARRIVAL'
          ? schedule?.checkInClose
          : schedule?.workEnd;
        if (!deadline || current.minuteOfDay > timeMinutes(deadline)) {
          throw new AppError(
            422,
            input.leaveType === 'LATE_ARRIVAL'
              ? 'LATE_ARRIVAL_REQUEST_DEADLINE_PASSED'
              : 'LEAVE_REQUEST_DEADLINE_PASSED',
            input.leaveType === 'LATE_ARRIVAL'
              ? 'Izin terlambat hanya dapat diajukan sampai batas check-in'
              : 'Izin hari ini hanya dapat diajukan sampai jam kerja selesai',
          );
        }
      }
      let storedAttachment: StoredRequestAttachment | undefined;
      try {
        if (attachment) {
          if (!attachmentStorage) {
            throw new AppError(500, 'ATTACHMENT_NOT_CONFIGURED', 'Penyimpanan lampiran belum dikonfigurasi');
          }
          storedAttachment = await attachmentStorage.upload(teacherId, 'leave', attachment);
        }
        return await repository.create(teacherId, input, storedAttachment);
      } catch (error) {
        if (storedAttachment && attachmentStorage) {
          await attachmentStorage.remove(storedAttachment.storagePath);
        }
        throw error;
      }
    },

    async listOwn(teacherId, rawInput) {
      const input = ListLeaveRequestsQuerySchema.parse(rawInput);
      const result = await repository.listOwn(teacherId, input);
      return LeaveRequestListResponseSchema.parse(paginated(result.records, result.totalItems, input.page, input.pageSize));
    },

    async cancel(teacherId, id) {
      const request = await repository.findOwn(teacherId, id);
      if (!request) throw new AppError(404, 'LEAVE_REQUEST_NOT_FOUND', 'Pengajuan izin tidak ditemukan');
      if (request.status !== 'PENDING') {
        throw new AppError(409, 'LEAVE_NOT_PENDING', 'Hanya izin Pending yang dapat dibatalkan');
      }
      return repository.cancel(teacherId, id);
    },

    async listAdmin(rawInput) {
      const input = ListAdminLeaveRequestsQuerySchema.parse(rawInput);
      const result = await repository.listAdmin(input);
      return AdminLeaveRequestListResponseSchema.parse(paginated(result.records, result.totalItems, input.page, input.pageSize));
    },

    async getAdmin(id) {
      const request = await repository.findAny(id);
      if (!request) throw new AppError(404, 'LEAVE_REQUEST_NOT_FOUND', 'Pengajuan izin tidak ditemukan');
      return request;
    },

    async approve(actorId, id, rawInput) {
      return decide(actorId, id, DecideLeaveRequestSchema.parse(rawInput), 'APPROVED');
    },
    async reject(actorId, id, rawInput) {
      return decide(actorId, id, DecideLeaveRequestSchema.parse(rawInput), 'REJECTED');
    },
  };
}

export function registerLeaveRequestRoutes(
  app: Express,
  authService: AuthService,
  leaveRequestService: LeaveRequestService,
): void {
  const teacherGuards = [createSessionGuard(authService), requireRole('USER', 'SECURITY_GUARD')];
  const adminGuards = [createSessionGuard(authService), requireRole('SUPER_ADMIN')];

  app.get('/api/leave-requests', ...teacherGuards, async (request, response, next) => {
    try {
      const parsed = ListLeaveRequestsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw validationError('Parameter daftar izin tidak valid', parsed.error.flatten());
      response.status(200).json(await leaveRequestService.listOwn(userId(request), parsed.data));
    } catch (error) { next(error); }
  });
  app.post('/api/leave-requests', ...teacherGuards, parseOptionalAttachment, async (request, response, next) => {
    try {
      const parsed = CreateLeaveRequestSchema.safeParse(multipartPayload(request));
      if (!parsed.success) throw validationError('Data pengajuan izin tidak valid', parsed.error.flatten());
      const attachment = validateUploadedAttachment(request.file);
      response.status(201).json({ leaveRequest: await leaveRequestService.create(staffUser(request), parsed.data, attachment) } satisfies { leaveRequest: LeaveRequest });
    } catch (error) { next(error); }
  });
  app.post('/api/leave-requests/:id/cancel', ...teacherGuards, async (request, response, next) => {
    try {
      const leaveRequest = await leaveRequestService.cancel(userId(request), leaveRequestId(request.params['id']));
      response.status(200).json({ leaveRequest } satisfies { leaveRequest: LeaveRequest });
    } catch (error) { next(error); }
  });
  app.get('/api/admin/leave-requests', ...adminGuards, async (request, response, next) => {
    try {
      const parsed = ListAdminLeaveRequestsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw validationError('Parameter approval izin tidak valid', parsed.error.flatten());
      response.status(200).json(await leaveRequestService.listAdmin(parsed.data));
    } catch (error) { next(error); }
  });
  app.get('/api/admin/leave-requests/:id', ...adminGuards, async (request, response, next) => {
    try {
      const result = { leaveRequest: await leaveRequestService.getAdmin(leaveRequestId(request.params['id'])) };
      response.status(200).json(AdminLeaveRequestDetailResponseSchema.parse(result));
    } catch (error) { next(error); }
  });
  for (const [action, status] of [['approve', 'APPROVED'], ['reject', 'REJECTED']] as const) {
    app.post(`/api/admin/leave-requests/:id/${action}`, ...adminGuards, async (request, response, next) => {
      try {
        const parsed = DecideLeaveRequestSchema.safeParse(request.body);
        if (!parsed.success) throw validationError('Keputusan izin tidak valid', parsed.error.flatten());
        const id = leaveRequestId(request.params['id']);
        const leaveRequest = status === 'APPROVED'
          ? await leaveRequestService.approve(userId(request), id, parsed.data)
          : await leaveRequestService.reject(userId(request), id, parsed.data);
        response.status(200).json({ leaveRequest } satisfies { leaveRequest: LeaveRequest });
      } catch (error) { next(error); }
    });
  }
}
