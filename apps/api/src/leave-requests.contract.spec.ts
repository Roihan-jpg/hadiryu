import {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
  LeaveRequestSchema,
  LeaveStatusSchema,
  LeaveTypeSchema,
  ListAdminLeaveRequestsQuerySchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('leave request contracts', () => {
  it('accepts exactly one date, an allowed type, and a reason', () => {
    expect(
      CreateLeaveRequestSchema.parse({
        leaveDate: '2026-08-26',
        leaveType: 'SICK',
        reason: '  Perlu berobat  ',
      }),
    ).toEqual({
      leaveDate: '2026-08-26',
      leaveType: 'SICK',
      reason: 'Perlu berobat',
    });
  });

  it('rejects date ranges and attachments outside the MVP contract', () => {
    expect(
      CreateLeaveRequestSchema.safeParse({
        leaveDate: '2026-08-26',
        leaveEndDate: '2026-08-27',
        leaveType: 'SICK',
        reason: 'Perlu berobat',
        attachment: 'document.pdf',
      }).success,
    ).toBe(false);
  });

  it('parses admin filters and rejects an empty decision note', () => {
    expect(
      ListAdminLeaveRequestsQuerySchema.parse({
        page: '2',
        pageSize: '10',
        status: 'PENDING',
        leaveDate: '2026-08-26',
        search: '  Guru  ',
      }),
    ).toEqual({
      page: 2,
      pageSize: 10,
      status: 'PENDING',
      leaveDate: '2026-08-26',
      search: 'Guru',
    });
    expect(DecideLeaveRequestSchema.safeParse({ decisionNote: '   ' }).success).toBe(
      false,
    );
  });

  it('supports every leave type and lifecycle status', () => {
    for (const leaveType of ['SICK', 'OFFICIAL_DUTY', 'FAMILY', 'OTHER', 'LATE_ARRIVAL']) {
      expect(LeaveTypeSchema.parse(leaveType)).toBe(leaveType);
    }
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) {
      expect(LeaveStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects decision metadata that contradicts the lifecycle status', () => {
    const base = {
      id: '40000000-0000-4000-8000-000000000001',
      teacherId: '50000000-0000-4000-8000-000000000001',
      leaveDate: '2026-08-26',
      leaveType: 'SICK',
      reason: 'Perlu berobat',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    expect(LeaveRequestSchema.safeParse({
      ...base,
      status: 'PENDING',
      decisionNote: null,
      decidedBy: '50000000-0000-4000-8000-000000000002',
      decidedAt: '2026-08-25T01:00:00.000Z',
    }).success).toBe(false);
    expect(LeaveRequestSchema.safeParse({
      ...base,
      status: 'APPROVED',
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
    }).success).toBe(false);
  });
});
