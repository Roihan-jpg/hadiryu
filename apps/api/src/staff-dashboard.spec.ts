import type {
  AuthUser,
  RequestQuotaResponse,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { createStaffDashboardService, type StaffDashboardRepository } from './staff-dashboard.js';

const teacher: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111', nip: '1001', fullName: 'Rani',
  role: 'USER', isActive: true, mustChangePassword: false,
};
const today: TodayAttendanceResponse = {
  serverNow: '2026-09-11T01:00:00.000Z', workDate: '2026-09-11', state: 'NON_WORKING_DAY',
  schedule: null, attendance: null,
};
const quotas: RequestQuotaResponse = {
  month: '2026-09',
  lateArrival: { limit: 2, used: 1, remaining: 1 },
  earlyDeparture: { limit: 2, used: 0, remaining: 2 },
};

describe('staff dashboard service', () => {
  it('keeps actual lateness while applying effective credit and paginating merged activity', async () => {
    const repository: StaffDashboardRepository = {
      load: async () => ({
        attendances: [{
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', workDate: '2026-09-10',
          checkInAt: '2026-09-10T00:15:00.000Z', checkOutAt: '2026-09-10T08:30:00.000Z',
          workStart: '07:00', workEnd: '15:35', workStartAt: '2026-09-10T00:00:00.000Z',
          workEndAt: '2026-09-10T08:35:00.000Z', targetMinutes: 515,
          workedMinutes: 495, workDeficitMinutes: 20, arrivalLateMinutes: 15,
          status: 'COMPLETED', scheduleType: 'WEEKDAY', lateArrivalStatus: 'PENDING',
          earlyDepartureStatus: null,
        }],
        leaves: [{
          type: 'LEAVE', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', workDate: '2026-09-10',
          occurredAt: '2026-09-10T00:00:00.000Z', leaveType: 'LATE_ARRIVAL', status: 'PENDING',
          reason: 'Kendaraan bermasalah', decisionNote: null, attachment: null,
        }],
        earlyDepartures: [], latestEarlyDeparture: null,
        chartDays: [
          { workDate: '2026-09-10', status: 'OPEN', targetMinutes: 515 },
          { workDate: '2026-09-11', status: 'ABSENT', targetMinutes: 515 },
          { workDate: '2026-09-12', status: 'LEAVE_APPROVED', targetMinutes: 515 },
          { workDate: '2026-09-13', status: 'NON_WORKING_DAY', targetMinutes: null },
          { workDate: '2026-09-14', status: 'FUTURE', targetMinutes: null },
        ],
        streakDays: [{
          workDate: '2026-09-10', kind: 'WORKING',
          attendance: { actualLateMinutes: 15, lateArrivalStatus: 'PENDING' },
        }],
      }),
    };
    const service = createStaffDashboardService({
      repository,
      attendanceService: { getToday: async () => today } as never,
      requestQuotaService: { get: async () => quotas },
      now: () => new Date('2026-09-11T01:00:00.000Z'),
    });

    const result = await service.get(teacher, { month: '2026-09', page: 1, pageSize: 1, type: 'ALL' });

    expect(result.metrics.actualLateDays).toBe(1);
    expect(result.metrics.effectiveLateDays).toBe(0);
    expect(result.attendanceTrend).toEqual([
      expect.objectContaining({
        workDate: '2026-09-10', status: 'COMPLETED',
        actual: expect.objectContaining({ checkInAt: '2026-09-10T00:15:00.000Z', checkOutAt: '2026-09-10T08:30:00.000Z', arrivalOffsetMinutes: -15, lateMinutes: 15, workedMinutes: 495, workDeficitMinutes: 20 }),
        effective: expect.objectContaining({ arrivalOffsetMinutes: 0, lateMinutes: 0, workedMinutes: 510, workDeficitMinutes: 5 }),
      }),
      expect.objectContaining({ workDate: '2026-09-11', status: 'ABSENT', actual: null, effective: null }),
      expect.objectContaining({ workDate: '2026-09-12', status: 'LEAVE_APPROVED', actual: null, effective: null }),
      expect.objectContaining({ workDate: '2026-09-13', status: 'NON_WORKING_DAY', actual: null, effective: null }),
      expect.objectContaining({ workDate: '2026-09-14', status: 'FUTURE', actual: null, effective: null }),
    ]);
    expect(result.activity.pagination).toMatchObject({ page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
    expect(result.streak).toMatchObject({ status: 'AVAILABLE', currentDays: 1, provisional: true, nextMilestone: 3, daysRemaining: 2 });
  });

  it.each([[2, 'NONE'], [3, 'RED'], [7, 'BLUE'], [14, 'PURPLE']])('assigns the %i-day streak tier', async (days, tier) => {
    const repository: StaffDashboardRepository = {
      load: async () => ({ attendances: [], leaves: [], earlyDepartures: [], latestEarlyDeparture: null,
        streakDays: Array.from({ length: days }, (_, index) => ({
          workDate: `2026-09-${String(10 - index).padStart(2, '0')}`, kind: 'WORKING' as const,
          attendance: { actualLateMinutes: 0, lateArrivalStatus: null },
        })),
      }),
    };
    const service = createStaffDashboardService({ repository, attendanceService: { getToday: async () => today } as never,
      requestQuotaService: { get: async () => quotas }, now: () => new Date('2026-09-11T01:00:00.000Z') });
    const result = await service.get(teacher, { month: '2026-09', page: 1, pageSize: 10, type: 'ALL' });
    expect(result.streak).toMatchObject({ currentDays: days, tier });
  });

  it('returns unavailable instead of estimating through missing configuration', async () => {
    const repository: StaffDashboardRepository = { load: async () => ({
      attendances: [], leaves: [], earlyDepartures: [], latestEarlyDeparture: null,
      streakDays: [{ workDate: '2026-09-10', kind: 'CONFIGURATION_MISSING', attendance: null }],
    }) };
    const service = createStaffDashboardService({ repository, attendanceService: { getToday: async () => today } as never,
      requestQuotaService: { get: async () => quotas }, now: () => new Date('2026-09-11T01:00:00.000Z') });
    const result = await service.get(teacher, { month: '2026-09', page: 1, pageSize: 10, type: 'ALL' });
    expect(result.streak).toEqual({ status: 'UNAVAILABLE', reason: 'CONFIGURATION_MISSING' });
  });
});
