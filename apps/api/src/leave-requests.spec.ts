import type {
  AdminLeaveRequest,
  LeaveRequest,
  ScheduleRule,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { AppError } from './auth.js';
import {
  createLeaveRequestService,
  type LeaveRequestRepository,
} from './leave-requests.js';

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

  async findAttendance(): Promise<boolean> { return this.attendance; }
  async findCalendarException() { return null; }
  async findSchedule(): Promise<ScheduleRule | null> { return schedule; }
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
  it('creates a future single-date request', async () => {
    const { service: leaveService, repository } = service();
    const result = await leaveService.create(teacherId, {
      leaveDate: '2026-08-26', leaveType: 'FAMILY', reason: 'Acara keluarga',
    });
    expect(result).toMatchObject({ teacherId, leaveType: 'FAMILY', status: 'PENDING' });
    expect(repository.saved).toMatchObject({ leaveDate: '2026-08-26' });
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
