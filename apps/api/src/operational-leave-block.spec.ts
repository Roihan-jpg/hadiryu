import { describe, expect, it } from 'vitest';

import { resolveOperationalLeaveBlock } from './operational-leave-block.js';

describe('resolveOperationalLeaveBlock', () => {
  it('blocks every operational action for a pending single-day absence', () => {
    expect(resolveOperationalLeaveBlock([{
      leaveDate: '2026-09-17', leaveType: 'SICK', status: 'PENDING',
      fullLeaveEndDate: null, earlyDepartureStartDate: null, earlyDepartureEndDate: null,
    }], '2026-09-17')).toMatchObject({
      leaveType: 'SICK', status: 'PENDING', phase: 'SINGLE_DAY',
      blockedActions: ['CHECK_IN', 'CHECKOUT', 'EARLY_DEPARTURE', 'CREATE_LEAVE'],
    });
  });

  it('does not block actions for late-arrival permission', () => {
    expect(resolveOperationalLeaveBlock([{
      leaveDate: '2026-09-17', leaveType: 'LATE_ARRIVAL', status: 'APPROVED',
      fullLeaveEndDate: null, earlyDepartureStartDate: null, earlyDepartureEndDate: null,
    }], '2026-09-17')).toBeNull();
  });

  it('blocks all actions during pending maternity full leave', () => {
    expect(resolveOperationalLeaveBlock([{
      leaveDate: '2026-08-17', leaveType: 'MATERNITY_LEAVE', status: 'PENDING',
      fullLeaveEndDate: '2026-10-16', earlyDepartureStartDate: '2026-10-17', earlyDepartureEndDate: '2028-10-16',
    }], '2026-09-17')).toMatchObject({ phase: 'FULL_LEAVE', blockedActions: ['CHECK_IN', 'CHECKOUT', 'EARLY_DEPARTURE', 'CREATE_LEAVE'] });
  });

  it('only blocks checkout and early departure during approved maternity 14.00 entitlement', () => {
    expect(resolveOperationalLeaveBlock([{
      leaveDate: '2026-08-17', leaveType: 'MATERNITY_LEAVE', status: 'APPROVED',
      fullLeaveEndDate: '2026-10-16', earlyDepartureStartDate: '2026-10-17', earlyDepartureEndDate: '2028-10-16',
    }], '2026-11-17')).toMatchObject({ phase: 'EARLY_DEPARTURE', blockedActions: ['CHECKOUT', 'EARLY_DEPARTURE'] });
  });
});
