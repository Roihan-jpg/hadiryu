import type { GeofenceRule, SecurityScheduleSettingsResponse } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import type { AttendanceRepository } from './attendance.js';
import { createSecurityDashboardService } from './security-dashboard.js';

const guardId = '11111111-1111-4111-8111-111111111111';
const settings: SecurityScheduleSettingsResponse = {
  effectiveOn: '2026-09-07',
  dayShift: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduleType: 'SECURITY_DAY', checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00', checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00', targetMinutes: 720, effectiveFrom: '2026-09-07', effectiveTo: null },
  nightShift: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduleType: 'SECURITY_NIGHT', checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00', checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720, effectiveFrom: '2026-09-07', effectiveTo: null },
  roster: { dayOneMorningGuardId: guardId, dayOneNightGuardId: '22222222-2222-4222-8222-222222222222', dayOneOffGuardId: '33333333-3333-4333-8333-333333333333', effectiveFrom: '2026-09-07', effectiveTo: null },
  preview: [],
};

function repository(): AttendanceRepository {
  const geofence: GeofenceRule = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', shape: 'CIRCLE', latitude: -8, longitude: 113, radiusMeters: 100, maxAccuracyMeters: 15, effectiveFrom: '2026-01-01', effectiveTo: null };
  return {
    findAttendance: async () => null,
    findCalendarException: async () => null,
    findSchedule: async () => null,
    findSecuritySchedules: async (workDate) => ({ ...settings, effectiveOn: workDate }),
    findGeofence: async () => geofence,
    hasApprovedLeave: async () => false,
    saveCheckIn: async () => { throw new Error('not used'); },
    saveCheckout: async () => { throw new Error('not used'); },
    listAttendanceHistory: async () => ({ records: [], totalItems: 0 }),
  };
}

describe('Satpam dashboard service', () => {
  it('shows today duty first and the next working duty', async () => {
    const result = await createSecurityDashboardService(
      repository(),
      () => new Date('2026-09-07T00:00:00.000Z'),
    ).getDashboard(guardId);
    expect(result.currentDuty).toMatchObject({ status: 'DAY', rotationDay: 1, workDate: '2026-09-07' });
    expect(result.currentDuty.boundaries?.workStartAt).toBe('2026-09-06T23:00:00.000Z');
    expect(result.nextWorkingDuty).toMatchObject({ status: 'NIGHT', rotationDay: 2, workDate: '2026-09-08' });
  });

  it('does not consult the school calendar for Sunday duty', async () => {
    const repo = repository();
    repo.findCalendarException = async () => { throw new Error('school calendar must not be read'); };
    const result = await createSecurityDashboardService(repo, () => new Date('2026-09-06T00:00:00.000Z')).getDashboard(guardId);
    expect(['DAY', 'NIGHT', 'OFF']).toContain(result.currentDuty.status);
  });

  it('shows yesterday night shift only while its timestamp snapshot is still open', async () => {
    const repo = repository();
    const nightGuardId = settings.roster!.dayOneNightGuardId;
    const attendance = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      workDate: '2026-09-07',
      checkInAt: '2026-09-07T11:30:00.000Z',
      latitude: -8,
      longitude: 113,
      accuracyMeters: 10,
      distanceMeters: 0,
      boundaryClearanceMeters: null,
      workStart: '18:00',
      workEnd: '06:00',
      checkoutClose: '08:00',
      targetMinutes: 720,
      arrivalLateMinutes: 0,
      scheduleType: 'SECURITY_NIGHT' as const,
      checkInOpenAt: '2026-09-07T10:00:00.000Z',
      workStartAt: '2026-09-07T11:00:00.000Z',
      checkInCloseAt: '2026-09-07T13:00:00.000Z',
      checkoutOpenAt: '2026-09-07T22:00:00.000Z',
      workEndAt: '2026-09-07T23:00:00.000Z',
      checkoutCloseAt: '2026-09-08T01:00:00.000Z',
      status: 'CHECKED_IN' as const,
    };
    repo.findAttendance = async (_id, workDate) => workDate === attendance.workDate ? attendance : null;
    repo.listAttendanceHistory = async () => ({ records: [attendance], totalItems: 1 });

    const active = await createSecurityDashboardService(
      repo,
      () => new Date('2026-09-07T23:30:00.000Z'),
    ).getDashboard(nightGuardId);
    const expired = await createSecurityDashboardService(
      repo,
      () => new Date('2026-09-08T01:30:00.000Z'),
    ).getDashboard(nightGuardId);

    expect(active.activeDuty).toMatchObject({ status: 'NIGHT', workDate: '2026-09-07' });
    expect(active.activeAttendance?.workDate).toBe('2026-09-07');
    expect(expired.activeDuty).toBeNull();
    expect(expired.activeAttendance).toBeNull();
  });

  it('describes an active night shift from its snapshot after the roster changes', async () => {
    const repo = repository();
    const nightGuardId = settings.roster!.dayOneNightGuardId;
    const attendance = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      workDate: '2026-09-07',
      checkInAt: '2026-09-07T11:30:00.000Z',
      latitude: -8,
      longitude: 113,
      accuracyMeters: 10,
      distanceMeters: 0,
      boundaryClearanceMeters: null,
      workStart: '18:00',
      workEnd: '06:00',
      checkoutClose: '08:00',
      targetMinutes: 720,
      arrivalLateMinutes: 0,
      scheduleType: 'SECURITY_NIGHT' as const,
      checkInOpenAt: '2026-09-07T10:00:00.000Z',
      workStartAt: '2026-09-07T11:00:00.000Z',
      checkInCloseAt: '2026-09-07T13:00:00.000Z',
      checkoutOpenAt: '2026-09-07T22:00:00.000Z',
      workEndAt: '2026-09-07T23:00:00.000Z',
      checkoutCloseAt: '2026-09-08T01:00:00.000Z',
      status: 'CHECKED_IN' as const,
    };
    repo.findAttendance = async (_id, workDate) => workDate === attendance.workDate ? attendance : null;
    repo.listAttendanceHistory = async () => ({ records: [attendance], totalItems: 1 });
    repo.findSecuritySchedules = async (workDate) => ({
      ...settings,
      effectiveOn: workDate,
      roster: {
        ...settings.roster!,
        dayOneNightGuardId: settings.roster!.dayOneOffGuardId,
        dayOneOffGuardId: nightGuardId,
      },
    });

    const result = await createSecurityDashboardService(
      repo,
      () => new Date('2026-09-08T00:30:00.000Z'),
    ).getDashboard(nightGuardId);

    expect(result.activeDuty).toMatchObject({
      status: 'NIGHT',
      scheduleType: 'SECURITY_NIGHT',
      workDate: attendance.workDate,
      boundaries: {
        checkoutOpenAt: attendance.checkoutOpenAt,
        workEndAt: attendance.workEndAt,
        checkoutCloseAt: attendance.checkoutCloseAt,
      },
    });
  });
});
