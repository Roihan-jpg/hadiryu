import { describe, expect, it } from 'vitest';

import { maternityLeavePeriods } from './maternity-leave.js';

describe('maternity leave periods', () => {
  it('uses calendar months for full leave and calendar years for the early-departure benefit', () => {
    expect(maternityLeavePeriods('2026-01-31')).toEqual({
      fullLeaveStartDate: '2026-01-31',
      fullLeaveEndDate: '2026-03-30',
      earlyDepartureStartDate: '2026-03-31',
      earlyDepartureEndDate: '2028-03-30',
    });
  });

  it('handles a leap-year filing date without extending either entitlement', () => {
    expect(maternityLeavePeriods('2028-02-29')).toEqual({
      fullLeaveStartDate: '2028-02-29',
      fullLeaveEndDate: '2028-04-28',
      earlyDepartureStartDate: '2028-04-29',
      earlyDepartureEndDate: '2030-04-28',
    });
  });
});
