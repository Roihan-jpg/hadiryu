import {
  CreateLeaveRequestSchema,
  DecideLeaveRequestSchema,
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
});
