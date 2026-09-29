import { describe, expect, it } from 'vitest';

import { AttendanceTrendDaySchema, StaffDashboardQuerySchema, TeacherStreakSchema } from '@absensi/contracts';

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

  it('accepts server-owned daily attendance statuses with separate actual and effective values', () => {
    expect(AttendanceTrendDaySchema.parse({
      workDate: '2026-09-10', status: 'COMPLETED', targetMinutes: 515,
      actual: { checkInAt: '2026-09-10T00:15:00.000Z', checkOutAt: '2026-09-10T08:30:00.000Z', arrivalOffsetMinutes: -15, lateMinutes: 15, workedMinutes: 495, workDeficitMinutes: 20 },
      effective: { arrivalOffsetMinutes: 0, lateMinutes: 0, workedMinutes: 510, workDeficitMinutes: 5 },
      credit: { lateArrival: true, earlyDeparture: false },
    })).toMatchObject({ status: 'COMPLETED', credit: { lateArrival: true } });
    expect(AttendanceTrendDaySchema.parse({
      workDate: '2026-09-11', status: 'LEAVE_APPROVED', targetMinutes: 515,
      actual: null, effective: null, credit: { lateArrival: false, earlyDeparture: false },
    }).status).toBe('LEAVE_APPROVED');
  });
});
