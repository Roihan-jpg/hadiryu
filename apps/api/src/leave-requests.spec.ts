import type {
  AdminLeaveRequest,
  LeaveRequest,
  ScheduleRule,
  SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  calculateApprovedLeaveCredit,
  createLeaveRequestService,
  type LeaveRequestRepository,
} from './leave-requests.js';
import type { RequestAttachmentStorage } from './request-attachments.js';

const teacherId = '50000000-0000-4000-8000-000000000001';
const adminId = '50000000-0000-4000-8000-000000000002';
const requestId = '40000000-0000-4000-8000-000000000001';
const schedule: ScheduleRule = {
  id: '30000000-0000-4000-8000-000000000001',
  scheduleType: 'WEEKDAY',
  checkInOpen: '06:30',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '15:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
};
const pending: LeaveRequest = {
  id: requestId,
  teacherId,
  leaveDate: '2026-08-26',
  leaveType: 'SICK',
  reason: 'Perlu berobat',
  status: 'PENDING',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

class FakeLeaveRepository implements LeaveRequestRepository {
  attendance = false;
  request: LeaveRequest | null = pending;
  saved: LeaveRequest | null = null;
  decisions: Array<{ status: 'APPROVED' | 'REJECTED'; actorId: string }> = [];
  securitySchedules?: SecurityScheduleSettingsResponse;

  async findAttendance(): Promise<boolean> { return this.attendance; }
  async findCalendarException() { return null; }
  async findSchedule(): Promise<ScheduleRule | null> { return schedule; }
  async findSecuritySchedules(): Promise<SecurityScheduleSettingsResponse> {
    if (!this.securitySchedules) throw new Error('not configured');
    return this.securitySchedules;
  }
  async create(_teacherId: string, input: { leaveDate: string; leaveType: LeaveRequest['leaveType']; reason: string }): Promise<LeaveRequest> {
    this.saved = { ...pending, ...input, id: '40000000-0000-4000-8000-000000000009', teacherId: _teacherId };
    return this.saved;
  }
  async findOwn(): Promise<LeaveRequest | null> { return this.request; }
  async cancel(): Promise<LeaveRequest> { return { ...pending, status: 'CANCELLED' }; }
  async listOwn() { return { records: this.request ? [this.request] : [], totalItems: this.request ? 1 : 0 }; }
  async findAny(): Promise<AdminLeaveRequest | null> {
    return this.request ? { ...this.request, teacherNip: '1987001', teacherFullName: 'Guru Satu' } : null;
  }
  async listAdmin() { return { records: [], totalItems: 0 }; }
  async decide(_id: string, actorId: string, status: 'APPROVED' | 'REJECTED'): Promise<LeaveRequest> {
    this.decisions.push({ status, actorId });
    return { ...pending, status, decidedBy: actorId, decidedAt: '2026-08-25T08:00:00.000Z' };
  }
  async writeDecisionAudit(): Promise<void> {}
}

function service(repository = new FakeLeaveRepository(), now = '2026-08-25T05:00:00.000Z') {
  return { repository, service: createLeaveRequestService(repository, () => new Date(now)) };
}

describe('leave request service', () => {
  it('gives approved leave the full target credit with no deficit', () => {
    expect(calculateApprovedLeaveCredit(515)).toEqual({
      workedMinutes: 515,
      workDeficitMinutes: 0,
    });
  });

  it('creates a future single-date request', async () => {
    const { service: leaveService, repository } = service();
    const result = await leaveService.create(teacherId, {
      leaveDate: '2026-08-26', leaveType: 'FAMILY', reason: 'Acara keluarga',
    });
    expect(result).toMatchObject({ teacherId, leaveType: 'FAMILY', status: 'PENDING' });
    expect(repository.saved).toMatchObject({ leaveDate: '2026-08-26' });
  });

  it('rejects leave on a Satpam rotation off day', async () => {
    const repository = new FakeLeaveRepository();
    repository.securitySchedules = {
      effectiveOn: '2026-08-26',
      dayShift: { ...schedule, scheduleType: 'SECURITY_DAY' },
      nightShift: { ...schedule, scheduleType: 'SECURITY_NIGHT', checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00', checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720 },
      roster: { dayOneMorningGuardId: '11111111-1111-4111-8111-111111111111', dayOneNightGuardId: '22222222-2222-4222-8222-222222222222', dayOneOffGuardId: teacherId, effectiveFrom: '2026-08-26', effectiveTo: null },
      preview: [],
    };
    await expect(createLeaveRequestService(repository, () => new Date('2026-08-25T05:00:00.000Z')).create(
      { id: teacherId, role: 'SECURITY_GUARD' },
      { leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Sakit' },
    )).rejects.toMatchObject({ code: 'LEAVE_NOT_ALLOWED_ON_OFF_DAY' });
  });

  it('accepts yesterday as the work date for a night-shift leave before its next-day deadline', async () => {
    const repository = new FakeLeaveRepository();
    repository.securitySchedules = {
      effectiveOn: '2026-08-25',
      dayShift: { ...schedule, scheduleType: 'SECURITY_DAY', targetMinutes: 720 },
      nightShift: {
        ...schedule,
        scheduleType: 'SECURITY_NIGHT',
        checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
        checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
      },
      roster: {
        dayOneMorningGuardId: '11111111-1111-4111-8111-111111111111',
        dayOneNightGuardId: teacherId,
        dayOneOffGuardId: '22222222-2222-4222-8222-222222222222',
        effectiveFrom: '2026-08-25', effectiveTo: null,
      },
      preview: [],
    };

    const result = await createLeaveRequestService(
      repository,
      () => new Date('2026-08-25T22:30:00.000Z'),
    ).create(
      { id: teacherId, role: 'SECURITY_GUARD' },
      { leaveDate: '2026-08-25', leaveType: 'SICK', reason: 'Sakit saat shift malam' },
    );

    expect(result).toMatchObject({ leaveDate: '2026-08-25', status: 'PENDING' });
  });

  it('removes an uploaded attachment when creating the database record fails', async () => {
    const repository = new FakeLeaveRepository();
    repository.create = async () => { throw new Error('database unavailable'); };
    const removed: string[] = [];
    const attachmentStorage: RequestAttachmentStorage = {
      async upload() {
        return {
          storagePath: `${teacherId}/leave/40000000-0000-4000-8000-000000000010.pdf`,
          originalName: 'bukti.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 8,
        };
      },
      async remove(storagePath) { removed.push(storagePath); },
    };
    const leaveService = createLeaveRequestService(
      repository,
      () => new Date('2026-08-25T05:00:00.000Z'),
      attachmentStorage,
    );

    await expect(leaveService.create(teacherId, {
      leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Perlu berobat',
    }, {
      originalName: 'bukti.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
      buffer: Buffer.from('%PDF-1.7'),
    })).rejects.toThrowError('database unavailable');
    expect(removed).toEqual([
      `${teacherId}/leave/40000000-0000-4000-8000-000000000010.pdf`,
    ]);
  });

  it('rejects past dates, requests after work ends, and dates with check-in', async () => {
    const { service: leaveService } = service();
    await expect(leaveService.create(teacherId, {
      leaveDate: '2026-08-24', leaveType: 'SICK', reason: 'Sakit',
    })).rejects.toMatchObject({ code: 'LEAVE_DATE_IN_PAST' } satisfies Partial<AppError>);
    const afterWork = service(new FakeLeaveRepository(), '2026-08-25T09:36:00.000Z').service;
    await expect(afterWork.create(teacherId, {
      leaveDate: '2026-08-25', leaveType: 'SICK', reason: 'Sakit',
    })).rejects.toMatchObject({ code: 'LEAVE_REQUEST_DEADLINE_PASSED' } satisfies Partial<AppError>);
    const conflict = new FakeLeaveRepository();
    conflict.attendance = true;
    await expect(service(conflict).service.create(teacherId, {
      leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Sakit',
    })).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' } satisfies Partial<AppError>);
  });

  it('allows only the owner to cancel a pending request', async () => {
    const { service: leaveService, repository } = service();
    await expect(leaveService.cancel(teacherId, requestId)).resolves.toMatchObject({ status: 'CANCELLED' });
    repository.request = { ...pending, status: 'APPROVED', decidedBy: adminId, decidedAt: pending.createdAt };
    await expect(leaveService.cancel(teacherId, requestId)).rejects.toMatchObject({ code: 'LEAVE_NOT_PENDING' } satisfies Partial<AppError>);
  });

  it('approves only a pending request with no check-in and writes an audit event', async () => {
    const { service: leaveService, repository } = service();
    await expect(leaveService.approve(adminId, requestId, { decisionNote: 'Disetujui' })).resolves.toMatchObject({ status: 'APPROVED', decidedBy: adminId });
    expect(repository.decisions).toEqual([{ status: 'APPROVED', actorId: adminId }]);
    repository.attendance = true;
    await expect(leaveService.approve(adminId, requestId, {})).rejects.toMatchObject({ code: 'ALREADY_CHECKED_IN' } satisfies Partial<AppError>);
  });
});
