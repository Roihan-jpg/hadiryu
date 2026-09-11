import type { CalendarException, ScheduleRule } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import {
  createMonthlyReportService,
  type MonthlyReportRepository,
  type MonthlyReportSource,
} from './monthly-report.js';

const weekday: ScheduleRule = {
  id: '10000000-0000-4000-8000-000000000001',
  scheduleType: 'WEEKDAY',
  checkInOpen: '06:00',
  workStart: '07:00',
  checkInClose: '08:00',
  checkoutOpen: '14:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
};
const saturday: ScheduleRule = {
  ...weekday,
  id: '10000000-0000-4000-8000-000000000002',
  scheduleType: 'SATURDAY',
  workEnd: '10:35',
  checkoutOpen: '10:00',
  checkoutClose: '12:00',
  targetMinutes: 215,
};
function source(input: Partial<MonthlyReportSource> = {}): MonthlyReportSource {
  return {
    teachers: [
      {
        teacherId: '50000000-0000-4000-8000-000000000001',
        teacherNip: '1987001',
        teacherFullName: 'Guru Satu',
        createdDate: '2020-01-01',
      },
    ],
    schedules: [weekday, saturday],
    calendarExceptions: [],
    attendances: [],
    leaves: [],
    earlyDepartures: [],
    ...input,
  };
}

class FakeMonthlyReportRepository implements MonthlyReportRepository {
  constructor(public data: MonthlyReportSource = source()) {}
  calls: Array<{ startDate: string; endDate: string }> = [];

  async loadMonth(startDate: string, endDate: string): Promise<MonthlyReportSource> {
    this.calls.push({ startDate, endDate });
    return this.data;
  }
}

function service(repository: FakeMonthlyReportRepository) {
  return createMonthlyReportService(repository, () =>
    new Date('2030-01-01T00:00:00.000Z'),
  );
}

describe('monthly report calculator', () => {
  it.each([
    [2027, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 8, 31],
  ])('builds exactly one result per teacher/date for %i-%i', async (year, month, days) => {
    const repository = new FakeMonthlyReportRepository();

    const result = await service(repository).preview({ year, month });

    expect(result.teachers[0]?.days).toHaveLength(days);
    expect(result.teachers[0]?.days[0]?.workDate).toBe(
      `${year}-${String(month).padStart(2, '0')}-01`,
    );
    expect(result.teachers[0]?.days.at(-1)?.workDate).toBe(result.endDate);
  });

  it('calculates weekday, Saturday, holiday, leave, absence, and incomplete attendance', async () => {
    const holiday: CalendarException = {
      id: '20000000-0000-4000-8000-000000000001',
      workDate: '2026-06-08',
      exceptionType: 'HOLIDAY',
      name: 'Libur sekolah',
      scheduleType: null,
    };
    const repository = new FakeMonthlyReportRepository(
      source({
        calendarExceptions: [holiday],
        attendances: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            teacherId: '50000000-0000-4000-8000-000000000001',
            workDate: '2026-06-01',
            checkInAt: '2026-06-01T00:05:00.000Z',
            checkOutAt: '2026-06-01T08:25:00.000Z',
            workStart: '07:00',
            workEnd: '15:35',
            checkoutClose: '17:00',
            targetMinutes: 515,
            workedMinutes: 500,
            arrivalLateMinutes: 5,
            workDeficitMinutes: 15,
            status: 'COMPLETED',
          },
          {
            id: '40000000-0000-4000-8000-000000000002',
            teacherId: '50000000-0000-4000-8000-000000000001',
            workDate: '2026-06-02',
            checkInAt: '2026-06-02T00:00:00.000Z',
            checkOutAt: null,
            workStart: '07:00',
            workEnd: '15:35',
            checkoutClose: '17:00',
            targetMinutes: 515,
            workedMinutes: null,
            arrivalLateMinutes: 0,
            workDeficitMinutes: null,
            status: 'CHECKED_IN',
          },
        ],
        leaves: [
          {
            teacherId: '50000000-0000-4000-8000-000000000001',
            leaveDate: '2026-06-03',
            leaveType: 'SICK',
            status: 'APPROVED',
          },
        ],
      }),
    );

    const result = await service(repository).preview({ year: 2026, month: 6 });
    const days = new Map(
      result.teachers[0]!.days.map((day) => [day.workDate, day]),
    );

    expect(days.get('2026-06-01')).toMatchObject({
      status: 'WORKED',
      scheduleType: 'WEEKDAY',
      workedMinutes: 500,
      workDeficitMinutes: 15,
    });
    expect(days.get('2026-06-02')).toMatchObject({
      status: 'INCOMPLETE',
      workedMinutes: 455,
      workDeficitMinutes: 60,
      checkOutAt: null,
    });
    expect(days.get('2026-06-03')).toMatchObject({
      status: 'LEAVE',
      workedMinutes: 515,
      workDeficitMinutes: 0,
      leaveType: 'SICK',
    });
    expect(days.get('2026-06-04')).toMatchObject({
      status: 'ABSENT',
      workedMinutes: 0,
      workDeficitMinutes: 515,
    });
    expect(days.get('2026-06-06')).toMatchObject({
      status: 'ABSENT',
      scheduleType: 'SATURDAY',
      targetMinutes: 215,
    });
    expect(days.get('2026-06-07')).toMatchObject({
      status: 'NON_WORKING_DAY',
      targetMinutes: 0,
      workDeficitMinutes: 0,
    });
    expect(days.get('2026-06-08')).toMatchObject({
      status: 'NON_WORKING_DAY',
      calendarExceptionName: 'Libur sekolah',
    });
    expect(result.teachers[0]?.totalWorkDeficitMinutes).toBe(
      result.teachers[0]?.days.reduce(
        (total, day) => total + (day.workDeficitMinutes ?? 0),
        0,
      ),
    );
    expect(result.teachers[0]?.absentDayCount).toBeGreaterThan(0);
  });

  it('does not flag future dates or an open attendance as missing data', async () => {
    const repository = new FakeMonthlyReportRepository(source({
      attendances: [{
        id: '40000000-0000-4000-8000-000000000010',
        teacherId: '50000000-0000-4000-8000-000000000001',
        workDate: '2026-06-10',
        checkInAt: '2026-06-10T00:00:00.000Z',
        checkOutAt: null,
        workStart: '07:00',
        workEnd: '15:35',
        checkoutClose: '17:00',
        targetMinutes: 515,
        workedMinutes: null,
        arrivalLateMinutes: 0,
        workDeficitMinutes: null,
        scheduleType: 'WEEKDAY',
        status: 'CHECKED_IN',
      }],
    }));
    const reportService = createMonthlyReportService(
      repository,
      () => new Date('2026-06-10T01:00:00.000Z'),
    );

    const report = await reportService.preview({ year: 2026, month: 6 });
    expect(report.teachers[0]?.days[9]).toMatchObject({
      status: 'IN_PROGRESS',
      workDeficitMinutes: null,
    });
    expect(report.teachers[0]?.days[10]).toMatchObject({
      status: 'NOT_YET_OCCURRED',
      workDeficitMinutes: null,
    });
    expect(report.issues.every((issue) =>
      issue.category !== 'STAFF_DATA' || issue.workDate < '2026-06-10',
    )).toBe(true);
  });

  it('uses a working-day override and sorts teachers by name then NIP', async () => {
    const repository = new FakeMonthlyReportRepository(
      source({
        teachers: [
          {
            teacherId: '50000000-0000-4000-8000-000000000003',
            teacherNip: '3',
            teacherFullName: 'Zahra',
            createdDate: '2020-01-01',
          },
          {
            teacherId: '50000000-0000-4000-8000-000000000002',
            teacherNip: '2',
            teacherFullName: 'Ayu',
            createdDate: '2020-01-01',
          },
          {
            teacherId: '50000000-0000-4000-8000-000000000001',
            teacherNip: '1',
            teacherFullName: 'Ayu',
            createdDate: '2020-01-01',
          },
        ],
        calendarExceptions: [
          {
            id: '20000000-0000-4000-8000-000000000001',
            workDate: '2026-06-07',
            exceptionType: 'WORKING_DAY',
            name: 'Pengganti Sabtu',
            scheduleType: 'SATURDAY',
          },
        ],
      }),
    );

    const result = await service(repository).preview({ year: 2026, month: 6 });

    expect(result.teachers.map((teacher) => teacher.teacherNip)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(result.teachers[0]?.days[6]).toMatchObject({
      workDate: '2026-06-07',
      status: 'ABSENT',
      scheduleType: 'SATURDAY',
      targetMinutes: 215,
      calendarExceptionName: 'Pengganti Sabtu',
    });
  });

  it('returns a draft and identifies the staff member when leave is Pending', async () => {
    const repository = new FakeMonthlyReportRepository(
      source({
        leaves: [
          {
            teacherId: '50000000-0000-4000-8000-000000000001',
            leaveDate: '2026-06-03',
            leaveType: 'OTHER',
            status: 'PENDING',
          },
        ],
      }),
    );

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.documentStatus).toBe('DRAFT');
    expect(report.issues).toContainEqual({
      category: 'STAFF_DATA',
      code: 'PENDING_LEAVE',
      teacherId: '50000000-0000-4000-8000-000000000001',
      teacherNip: '1987001',
      teacherFullName: 'Guru Satu',
      teacherRole: 'USER',
      teacherWhatsapp: null,
      workDate: '2026-06-03',
    });
  });

  it('credits approved early departure and charges rejected empty time proportionally', async () => {
    const completed = {
      id: '40000000-0000-4000-8000-000000000001',
      teacherId: '50000000-0000-4000-8000-000000000001',
      workDate: '2026-06-01',
      checkInAt: '2026-06-01T00:05:00.000Z',
      checkOutAt: '2026-06-01T07:05:00.000Z',
      workStart: '07:00',
      workEnd: '15:35',
      checkoutClose: '17:00',
      targetMinutes: 515,
      workedMinutes: 420,
      arrivalLateMinutes: 5,
      workDeficitMinutes: 95,
      status: 'COMPLETED' as const,
    };
    const rejectedRepository = new FakeMonthlyReportRepository(
      source({
        attendances: [completed],
        earlyDepartures: [
          {
            attendanceId: completed.id,
            teacherId: completed.teacherId,
            workDate: completed.workDate,
            requestedAt: completed.checkOutAt,
            status: 'REJECTED',
          },
        ],
      }),
    );

    const rejected = await service(rejectedRepository).preview({ year: 2026, month: 6 });
    expect(rejected.teachers[0]?.days[0]).toMatchObject({
      workedMinutes: 420,
      workDeficitMinutes: 95,
    });
    expect(rejected.teachers[0]).toMatchObject({
      lateDayCount: 1,
      rejectedEarlyDepartureMinutes: 90,
    });

    const approvedRepository = new FakeMonthlyReportRepository(
      source({
        attendances: [{
          ...completed,
          checkInAt: '2026-06-01T00:00:00.000Z',
          workedMinutes: 425,
          arrivalLateMinutes: 0,
          workDeficitMinutes: 90,
        }],
        earlyDepartures: [
          {
            attendanceId: completed.id,
            teacherId: completed.teacherId,
            workDate: completed.workDate,
            requestedAt: completed.checkOutAt,
            status: 'APPROVED',
          },
        ],
      }),
    );
    const approved = await service(approvedRepository).preview({ year: 2026, month: 6 });
    expect(approved.teachers[0]?.days[0]).toMatchObject({
      workedMinutes: 515,
      workDeficitMinutes: 0,
    });
  });

  it('provisionally credits a Pending late arrival and combines it per segment with early departure', async () => {
    const attendance = {
      id: '40000000-0000-4000-8000-000000000001',
      teacherId: '50000000-0000-4000-8000-000000000001',
      workDate: '2026-06-01',
      checkInAt: '2026-06-01T00:05:00.000Z',
      checkOutAt: '2026-06-01T07:05:00.000Z',
      workStart: '07:00',
      workEnd: '15:35',
      checkoutClose: '17:00',
      targetMinutes: 515,
      workedMinutes: 420,
      arrivalLateMinutes: 5,
      workDeficitMinutes: 95,
      status: 'COMPLETED' as const,
    };
    const repository = new FakeMonthlyReportRepository(source({
      attendances: [attendance],
      leaves: [{
        teacherId: attendance.teacherId,
        leaveDate: attendance.workDate,
        leaveType: 'LATE_ARRIVAL',
        status: 'PENDING',
      }],
      earlyDepartures: [{
        attendanceId: attendance.id,
        teacherId: attendance.teacherId,
        workDate: attendance.workDate,
        requestedAt: attendance.checkOutAt,
        status: 'APPROVED',
      }],
    }));

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.documentStatus).toBe('DRAFT');
    expect(report.teachers[0]?.days[0]).toMatchObject({
      status: 'WORKED',
      workedMinutes: 515,
      arrivalLateMinutes: 0,
      workDeficitMinutes: 0,
      leaveType: null,
    });
    expect(report.teachers[0]?.lateDayCount).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'PENDING_LEAVE',
      workDate: '2026-06-01',
    }));
  });

  it('caps rejected early-departure empty time at the daily target', async () => {
    const attendance = {
      id: '40000000-0000-4000-8000-000000000001',
      teacherId: '50000000-0000-4000-8000-000000000001',
      workDate: '2026-06-01',
      checkInAt: '2026-05-31T22:30:00.000Z',
      checkOutAt: '2026-05-31T22:31:00.000Z',
      workStart: '07:00',
      workEnd: '15:35',
      checkoutClose: '17:00',
      targetMinutes: 515,
      workedMinutes: 1,
      arrivalLateMinutes: 0,
      workDeficitMinutes: 514,
      status: 'COMPLETED' as const,
    };
    const repository = new FakeMonthlyReportRepository(
      source({
        attendances: [attendance],
        earlyDepartures: [
          {
            attendanceId: attendance.id,
            teacherId: attendance.teacherId,
            workDate: attendance.workDate,
            requestedAt: attendance.checkOutAt,
            status: 'REJECTED',
          },
        ],
      }),
    );

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.teachers[0]?.days[0]).toMatchObject({
      targetMinutes: 515,
      workedMinutes: 0,
      workDeficitMinutes: 515,
    });
    expect(report.teachers[0]?.rejectedEarlyDepartureMinutes).toBe(515);
  });

  it('returns a draft when an early departure request is Pending', async () => {
    const repository = new FakeMonthlyReportRepository(
      source({
        earlyDepartures: [
          {
            attendanceId: '40000000-0000-4000-8000-000000000001',
            teacherId: '50000000-0000-4000-8000-000000000001',
            workDate: '2026-06-01',
            requestedAt: '2026-06-01T07:05:00.000Z',
            status: 'PENDING',
          },
        ],
      }),
    );

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.documentStatus).toBe('DRAFT');
    expect(report.issues).toContainEqual({
      category: 'STAFF_DATA',
      code: 'PENDING_EARLY_DEPARTURE',
      teacherId: '50000000-0000-4000-8000-000000000001',
      teacherNip: '1987001',
      teacherFullName: 'Guru Satu',
      teacherRole: 'USER',
      teacherWhatsapp: null,
      workDate: '2026-06-01',
    });
  });

  it('keeps historical schedule gaps blank and exportable as a draft', async () => {
    const repository = new FakeMonthlyReportRepository(
      source({ schedules: [] }),
    );

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.documentStatus).toBe('DRAFT');
    expect(report.issues).toContainEqual({
      category: 'CONFIGURATION',
      code: 'SCHOOL_SCHEDULE_COVERAGE_MISSING',
      source: 'SCHOOL_SCHEDULE',
      missingRanges: expect.any(Array),
    });
    expect(report.teachers[0]?.days[0]).toMatchObject({
      status: 'CONFIGURATION_MISSING',
      targetMinutes: null,
      workDeficitMinutes: null,
    });
  });

  it('warns about the exact gap before the first Satpam roster and still previews', async () => {
    const guardId = '50000000-0000-4000-8000-000000000002';
    const repository = new FakeMonthlyReportRepository(source({
      teachers: [{
        teacherId: guardId,
        teacherNip: 'SATPAM-1',
        teacherFullName: 'Satpam Satu',
        role: 'SECURITY_GUARD',
        createdDate: '2026-09-01',
      }],
      securitySettings: [{
        dayShift: { ...weekday, scheduleType: 'SECURITY_DAY', effectiveFrom: '2026-09-07' },
        nightShift: { ...weekday, scheduleType: 'SECURITY_NIGHT', effectiveFrom: '2026-09-07' },
        roster: {
          dayOneMorningGuardId: guardId,
          dayOneNightGuardId: '60000000-0000-4000-8000-000000000002',
          dayOneOffGuardId: '60000000-0000-4000-8000-000000000003',
          effectiveFrom: '2026-09-07',
          effectiveTo: null,
        },
      }],
    }));

    const readiness = await service(repository).readiness({ year: 2026, month: 9 });

    expect(readiness).toEqual({
      status: 'READY_WITH_WARNINGS',
      year: 2026,
      month: 9,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      issues: [{
        code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
        source: 'SECURITY_SCHEDULE',
        missingRanges: [{ startDate: '2026-09-01', endDate: '2026-09-06' }],
      }],
    });
    const report = await service(repository).preview({ year: 2026, month: 9 });
    expect(report.documentStatus).toBe('DRAFT');
    expect(report.teachers[0]?.days[0]).toMatchObject({
      status: 'CONFIGURATION_MISSING',
      targetMinutes: null,
    });
  });

  it('does not require a Satpam roster before the account creation date', async () => {
    const guardId = '50000000-0000-4000-8000-000000000002';
    const repository = new FakeMonthlyReportRepository(source({
      teachers: [{
        teacherId: guardId,
        teacherNip: 'SATPAM-1',
        teacherFullName: 'Satpam Satu',
        role: 'SECURITY_GUARD',
        createdDate: '2026-09-07',
      }],
      securitySettings: [{
        dayShift: { ...weekday, scheduleType: 'SECURITY_DAY', effectiveFrom: '2026-09-07' },
        nightShift: { ...weekday, scheduleType: 'SECURITY_NIGHT', effectiveFrom: '2026-09-07' },
        roster: {
          dayOneMorningGuardId: guardId,
          dayOneNightGuardId: '60000000-0000-4000-8000-000000000002',
          dayOneOffGuardId: '60000000-0000-4000-8000-000000000003',
          effectiveFrom: '2026-09-07',
          effectiveTo: null,
        },
      }],
    }));

    await expect(
      service(repository).readiness({ year: 2026, month: 9 }),
    ).resolves.toMatchObject({ status: 'READY', issues: [] });
  });

  it('does not require report data before the configured operational start date', async () => {
    const guardId = '50000000-0000-4000-8000-000000000002';
    const repository = new FakeMonthlyReportRepository(source({
      operationalStartDate: '2026-09-07',
      teachers: [{
        teacherId: guardId,
        teacherNip: 'SATPAM-1',
        teacherFullName: 'Satpam Satu',
        role: 'SECURITY_GUARD',
        createdDate: '2026-09-01',
      }],
      securitySettings: [{
        dayShift: { ...weekday, scheduleType: 'SECURITY_DAY', effectiveFrom: '2026-09-07' },
        nightShift: { ...weekday, scheduleType: 'SECURITY_NIGHT', effectiveFrom: '2026-09-07' },
        roster: {
          dayOneMorningGuardId: guardId,
          dayOneNightGuardId: '60000000-0000-4000-8000-000000000002',
          dayOneOffGuardId: '60000000-0000-4000-8000-000000000003',
          effectiveFrom: '2026-09-07',
          effectiveTo: null,
        },
      }],
    }));

    await expect(
      service(repository).readiness({ year: 2026, month: 9 }),
    ).resolves.toMatchObject({ status: 'READY', issues: [] });
    const report = await service(repository).preview({ year: 2026, month: 9 });
    expect(report.teachers[0]?.days.slice(0, 6).every(
      (day) => day.status === 'NON_WORKING_DAY',
    )).toBe(true);
  });

  it('keeps a started Satpam shift from its attendance snapshot after the same-day roster changes', async () => {
    const guardId = '50000000-0000-4000-8000-000000000001';
    const dayShift: ScheduleRule = {
      ...weekday,
      id: '10000000-0000-4000-8000-000000000003',
      scheduleType: 'SECURITY_DAY',
      targetMinutes: 720,
    };
    const nightShift: ScheduleRule = {
      ...weekday,
      id: '10000000-0000-4000-8000-000000000004',
      scheduleType: 'SECURITY_NIGHT',
      checkInOpen: '17:00',
      workStart: '18:00',
      checkInClose: '20:00',
      checkoutOpen: '05:00',
      workEnd: '06:00',
      checkoutClose: '08:00',
      targetMinutes: 720,
    };
    const repository = new FakeMonthlyReportRepository(source({
      teachers: [{
        teacherId: guardId,
        teacherNip: 'SATPAM-1',
        teacherFullName: 'Satpam Satu',
        role: 'SECURITY_GUARD',
        createdDate: '2020-01-01',
      }],
      attendances: [{
        id: '40000000-0000-4000-8000-000000000003',
        teacherId: guardId,
        workDate: '2026-06-01',
        checkInAt: '2026-06-01T11:00:00.000Z',
        checkOutAt: '2026-06-01T23:00:00.000Z',
        workStart: '18:00',
        workEnd: '06:00',
        checkoutClose: '08:00',
        targetMinutes: 720,
        workedMinutes: 720,
        arrivalLateMinutes: 0,
        workDeficitMinutes: 0,
        scheduleType: 'SECURITY_NIGHT',
        workEndAt: '2026-06-01T23:00:00.000Z',
        status: 'COMPLETED',
      }],
      securitySettings: [{
        dayShift,
        nightShift,
        roster: {
          dayOneMorningGuardId: '60000000-0000-4000-8000-000000000001',
          dayOneNightGuardId: '60000000-0000-4000-8000-000000000002',
          dayOneOffGuardId: guardId,
          effectiveFrom: '2026-06-01',
          effectiveTo: null,
        },
      }],
    }));

    const report = await service(repository).preview({ year: 2026, month: 6 });

    expect(report.teachers[0]?.days[0]).toMatchObject({
      status: 'WORKED',
      scheduleType: 'SECURITY_NIGHT',
      targetMinutes: 720,
      workedMinutes: 720,
      workDeficitMinutes: 0,
    });
  });
});
