import { describe, expect, it } from 'vitest';
import { createAdminDashboard } from './admin-dashboard.js';
import type { AdminAttendanceRepository, AdminAttendanceSource } from './admin-attendance.js';

const date = '2026-08-25';
const schedule = { id: '40000000-0000-4000-8000-000000000001', scheduleType: 'WEEKDAY' as const,
  checkInOpen: '06:00', workStart: '07:00', checkInClose: '09:00', checkoutOpen: '15:00', workEnd: '15:35', checkoutClose: '17:00', targetMinutes: 515, effectiveFrom: '2026-01-01', effectiveTo: null };
const source = (id: number, arrival: string | null, late = 0): AdminAttendanceSource => ({
  teacherId: `50000000-0000-4000-8000-${String(id).padStart(12, '0')}`, teacherNip: String(id), teacherFullName: `Guru ${id}`, role: 'USER', approvedLeave: null, notes: [],
  attendance: arrival ? { id: `40000000-0000-4000-8000-${String(id).padStart(12, '0')}`, checkInAt: arrival, checkOutAt: null, checkoutClose: '17:00', workStart: '07:00', workEnd: '15:35', targetMinutes: 515, workedMinutes: null, workDeficitMinutes: null, arrivalLateMinutes: late, status: 'CHECKED_IN' } : null,
});
function repository(records: AdminAttendanceSource[]): AdminAttendanceRepository {
  return { findCalendarException: async () => null, findSchedule: async () => schedule,
    listDailySources: async (day) => day === date ? records : [],
    attendanceExists: async () => false, createNote: async () => { throw new Error('read only'); } };
}
describe('Ritme Sekolah dashboard', () => {
  it('counts actual arrivals including late and incomplete, groups equal instants and preserves permission timestamps', async () => {
    const permission = source(2, `${date}T00:08:00.000Z`, 8);
    permission.attendance!.lateArrivalStatus = 'APPROVED';
    const result = await createAdminDashboard(repository([source(1, `${date}T00:08:00.000Z`, 8), permission, source(3, null)]), new Date(`${date}T11:00:00Z`), date);
    expect(result.day).toMatchObject({ scheduled: 3, arrived: 2, late: 1, notCheckedIn: 1 });
    expect(result.arrivals).toEqual([{ at: `${date}T00:08:00.000Z`, count: 2, cumulative: 2 }]);
    expect(result.trend).toHaveLength(7);
    expect(result.trend[0]?.workDate).toBe('2026-08-19');
  });
  it('does not draw arrivals after the server observation time', async () => {
    const result = await createAdminDashboard(repository([]), new Date(`${date}T00:20:00Z`), date);
    expect(result.window?.observedUntil).toBe(`${date}T00:20:00.000Z`);
    expect(result.day.provisional).toBe(true);
  });
  it('represents missing configuration as unavailable rather than zero', async () => {
    const repo = repository([]); repo.findSchedule = async () => null;
    const result = await createAdminDashboard(repo, new Date(`${date}T01:00:00Z`), date);
    expect(result.day).toMatchObject({ state: 'UNCONFIGURED', scheduled: null, arrived: null });
    expect(result.window).toBeNull();
  });
  it('represents Sunday as a holiday', async () => {
    const result = await createAdminDashboard(repository([]), new Date('2026-08-30T01:00:00Z'), '2026-08-30');
    expect(result.day.state).toBe('HOLIDAY');
    expect(result.window).toBeNull();
  });

  it('uses Jakarta server date and leaves the chart empty before check-in opens', async () => {
    const result = await createAdminDashboard(repository([]), new Date('2026-08-24T22:00:00Z'));
    expect(result.workDate).toBe(date);
    expect(result.window?.observedUntil).toBe('2026-08-24T22:00:00.000Z');
    expect(result.arrivals).toEqual([]);
  });

  it('excludes teachers created after the selected date and dates before operations', async () => {
    const future = { ...source(1, null), createdAt: '2026-08-25T18:00:00Z' };
    const repo = repository([future, source(2, null)]);
    repo.findOperationalStart = async () => date;
    const result = await createAdminDashboard(repo, new Date(`${date}T01:00:00Z`), date);
    expect(result.day.scheduled).toBe(1);
    expect(result.trend.slice(0, 6).every((day) => day.state === 'NOT_STARTED' && day.arrived === null)).toBe(true);
  });

  it('does not mix guards into teacher totals and preserves the overnight snapshot', async () => {
    const guard = { ...source(8, `${date}T11:00:00Z`), role: 'SECURITY_GUARD' as const };
    guard.attendance = { ...guard.attendance!, scheduleType: 'SECURITY_NIGHT', workStartAt: `${date}T11:00:00Z`, workEndAt: '2026-08-26T23:00:00Z', checkoutCloseAt: '2026-08-26T23:30:00Z' };
    const repo = repository([source(1, null), guard]);
    const result = await createAdminDashboard(repo, new Date('2026-08-25T18:30:00Z'), date);
    expect(result.day.scheduled).toBe(1);
    expect(result.guards[0]).toMatchObject({ assignment: 'NIGHT', status: 'Sudah check-in', endAt: '2026-08-26T23:00:00Z' });
  });

  it('aggregates more than one table page without losing arrivals', async () => {
    const repo = repository(Array.from({ length: 130 }, (_, i) => source(i + 1, `${date}T00:00:00Z`)));
    const result = await createAdminDashboard(repo, new Date(`${date}T01:00:00Z`), date);
    expect(result.day.arrived).toBe(130);
    expect(result.arrivals[0]?.cumulative).toBe(130);
  });

  it('uses one batched seven-day source load for edge runtimes with subrequest limits', async () => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const workDate = new Date(Date.UTC(2026, 7, 19 + index)).toISOString().slice(0, 10);
      return {
        workDate,
        exception: null,
        sources: workDate === date ? [source(1, `${date}T00:08:00.000Z`)] : [],
      };
    });
    const repo = {
      ...repository([]),
      listDashboardDays: async (workDates: readonly string[]) => {
        expect(workDates).toEqual(days.map((day) => day.workDate));
        return days;
      },
      findCalendarException: async () => {
        throw new Error('per-day calendar lookup must not run');
      },
      listDailySources: async () => {
        throw new Error('per-day source lookup must not run');
      },
    } as AdminAttendanceRepository;

    const result = await createAdminDashboard(
      repo,
      new Date(`${date}T01:00:00Z`),
      date,
    );

    expect(result.day.arrived).toBe(1);
  });
});
