import type {
  CheckInRecord,
  CompletedAttendanceRecord,
  GeofenceRule,
  SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceService,
  type AttendanceRepository,
  type PersistedAttendanceRecord,
  type SaveCheckInInput,
  type SaveCheckoutInput,
} from './attendance.js';

const guardId = '22222222-2222-4222-8222-222222222222';
const settings: SecurityScheduleSettingsResponse = {
  effectiveOn: '2026-09-06',
  dayShift: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduleType: 'SECURITY_DAY', checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00', checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00', targetMinutes: 720, effectiveFrom: '2026-09-06', effectiveTo: null },
  nightShift: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', scheduleType: 'SECURITY_NIGHT', checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00', checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720, effectiveFrom: '2026-09-06', effectiveTo: null },
  roster: { dayOneMorningGuardId: '11111111-1111-4111-8111-111111111111', dayOneNightGuardId: guardId, dayOneOffGuardId: '33333333-3333-4333-8333-333333333333', effectiveFrom: '2026-09-06', effectiveTo: null },
  preview: [],
};
const geofence: GeofenceRule = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', shape: 'CIRCLE', latitude: -8, longitude: 113, radiusMeters: 100, maxAccuracyMeters: 20, effectiveFrom: '2026-01-01', effectiveTo: null };

class SecurityRepository implements AttendanceRepository {
  records = new Map<string, PersistedAttendanceRecord>();
  calendarReads = 0;

  async findAttendance(_guardId: string, workDate: string) {
    return this.records.get(workDate) ?? null;
  }
  async findCalendarException(): Promise<null> { this.calendarReads += 1; throw new Error('Satpam must bypass school calendar'); }
  async findSchedule() { return null; }
  async findSecuritySchedules(workDate: string) { return { ...settings, effectiveOn: workDate }; }
  async findGeofence() { return geofence; }
  async hasApprovedLeave() { return false; }
  async saveCheckIn(input: SaveCheckInInput): Promise<CheckInRecord> {
    const record: CheckInRecord = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', workDate: input.workDate,
      checkInAt: input.checkInAt, latitude: input.location.latitude, longitude: input.location.longitude,
      accuracyMeters: input.location.accuracyMeters, distanceMeters: input.distanceMeters,
      boundaryClearanceMeters: input.boundaryClearanceMeters, workStart: input.schedule.workStart,
      workEnd: input.schedule.workEnd, checkoutClose: input.schedule.checkoutClose,
      targetMinutes: input.schedule.targetMinutes, arrivalLateMinutes: input.arrivalLateMinutes,
      scheduleType: input.schedule.scheduleType, ...input.boundaries, status: 'CHECKED_IN',
    };
    this.records.set(input.workDate, record);
    return record;
  }
  async saveCheckout(input: SaveCheckoutInput): Promise<CompletedAttendanceRecord> {
    const current = this.records.get(input.workDate) as CheckInRecord;
    const record: CompletedAttendanceRecord = {
      ...current, checkOutAt: input.checkOutAt,
      checkOutLatitude: input.location.latitude, checkOutLongitude: input.location.longitude,
      checkOutAccuracyMeters: input.location.accuracyMeters, checkOutDistanceMeters: input.distanceMeters,
      checkOutBoundaryClearanceMeters: input.boundaryClearanceMeters,
      workedMinutes: input.workedMinutes, workDeficitMinutes: input.workDeficitMinutes, status: 'COMPLETED',
    };
    this.records.set(input.workDate, record);
    return record;
  }
  async listAttendanceHistory() {
    const records = [...this.records.values()].sort((left, right) => right.workDate.localeCompare(left.workDate));
    return { records, totalItems: records.length };
  }
}

describe('Satpam overnight attendance', () => {
  it('checks in on Sunday without consulting the school calendar', async () => {
    const repository = new SecurityRepository();
    const result = await createAttendanceService(repository, () => new Date('2026-09-06T11:30:00.000Z')).checkIn(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );
    expect(result).toMatchObject({ workDate: '2026-09-06', scheduleType: 'SECURITY_NIGHT', checkoutCloseAt: '2026-09-07T01:00:00.000Z' });
    expect(repository.calendarReads).toBe(0);
  });

  it('checks out the previous work date after midnight using its immutable timestamp snapshot', async () => {
    const repository = new SecurityRepository();
    await createAttendanceService(repository, () => new Date('2026-09-06T11:30:00.000Z')).checkIn(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );
    repository.findSecuritySchedules = async () => {
      throw new Error('checkout must use the attendance snapshot');
    };
    const result = await createAttendanceService(repository, () => new Date('2026-09-06T23:30:00.000Z')).checkout(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );
    expect(result).toMatchObject({ workDate: '2026-09-06', status: 'COMPLETED', workedMinutes: 720, workDeficitMinutes: 0 });

    const repeated = await createAttendanceService(repository, () => new Date('2026-09-06T23:31:00.000Z')).checkout(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );
    expect(repeated.id).toBe(result.id);
  });

  it('prioritizes an active night shift from yesterday over a record for today', async () => {
    const repository = new SecurityRepository();
    await createAttendanceService(repository, () => new Date('2026-09-06T11:30:00.000Z')).checkIn(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );
    repository.records.set('2026-09-07', {
      ...(repository.records.get('2026-09-06') as CheckInRecord),
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      workDate: '2026-09-07',
      status: 'COMPLETED',
      checkOutAt: '2026-09-07T12:00:00.000Z',
      checkOutLatitude: -8,
      checkOutLongitude: 113,
      checkOutAccuracyMeters: 10,
      checkOutDistanceMeters: 0,
      checkOutBoundaryClearanceMeters: null,
      workedMinutes: 720,
      workDeficitMinutes: 0,
    });

    const result = await createAttendanceService(repository, () => new Date('2026-09-06T23:30:00.000Z')).checkout(
      { id: guardId, role: 'SECURITY_GUARD' },
      { latitude: -8, longitude: 113, accuracyMeters: 10 },
    );

    expect(result.workDate).toBe('2026-09-06');
    expect(repository.records.get('2026-09-07')?.id).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });
});
