import { describe, expect, it } from 'vitest';

import { StaffDashboardQuerySchema, TeacherStreakSchema } from '@absensi/contracts';

describe('staff dashboard contract', () => {
  it('coerces pagination and defaults the activity filter', () => {
    expect(StaffDashboardQuerySchema.parse({ month: '2026-09', page: '2', pageSize: '8' })).toEqual({
      month: '2026-09', page: 2, pageSize: 8, type: 'ALL',
    });
  });

  it('keeps unavailable streak distinct from a zero-day streak', () => {
    expect(TeacherStreakSchema.parse({ status: 'UNAVAILABLE', reason: 'CONFIGURATION_MISSING' })).toEqual({
      status: 'UNAVAILABLE', reason: 'CONFIGURATION_MISSING',
    });
    const available = TeacherStreakSchema.parse({
      status: 'AVAILABLE', currentDays: 0, tier: 'NONE', nextMilestone: 3, daysRemaining: 3, provisional: false,
    });
    expect(available.status === 'AVAILABLE' ? available.currentDays : null).toBe(0);
  });
});
