import {
  MonthlyReportParamsSchema,
  MonthlyReportPreviewSchema,
  MonthlyReportReadinessSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('monthly report contracts', () => {
  it('parses a bounded calendar year and month from route parameters', () => {
    expect(MonthlyReportParamsSchema.parse({ year: '2028', month: '2' })).toEqual({
      year: 2028,
      month: 2,
    });
    expect(
      MonthlyReportParamsSchema.safeParse({ year: '2028', month: '13' }).success,
    ).toBe(false);
  });

  it('represents one deterministic result per teacher and calendar date', () => {
    const days: Array<Record<string, unknown>> = Array.from(
      { length: 29 },
      (_, index) => ({
      workDate: `2028-02-${String(index + 1).padStart(2, '0')}`,
      scheduleType: null,
      status: 'NON_WORKING_DAY',
      attendanceId: null,
      checkInAt: null,
      checkOutAt: null,
      workStart: null,
      workEnd: null,
      targetMinutes: 0,
      workedMinutes: 0,
      arrivalLateMinutes: 0,
      workDeficitMinutes: 0,
      leaveType: null,
      calendarExceptionName: null,
      }),
    );
    days[0] = {
      ...days[0]!,
      scheduleType: 'WEEKDAY',
      status: 'WORKED',
      attendanceId: '40000000-0000-4000-8000-000000000001',
      checkInAt: '2028-02-01T00:00:00.000Z',
      checkOutAt: '2028-02-01T08:35:00.000Z',
      workStart: '07:00',
      workEnd: '15:35',
      targetMinutes: 515,
      workedMinutes: 515,
    };
    const result = MonthlyReportPreviewSchema.parse({
      year: 2028,
      month: 2,
      startDate: '2028-02-01',
      endDate: '2028-02-29',
      generatedAt: '2028-03-01T00:00:00.000Z',
      documentStatus: 'FINAL',
      issues: [],
      teachers: [
        {
          teacherId: '50000000-0000-4000-8000-000000000001',
          teacherNip: '1987001',
          teacherFullName: 'Guru Satu',
          days,
          totalWorkDeficitMinutes: 0,
          lateDayCount: 0,
          absentDayCount: 0,
          rejectedEarlyDepartureMinutes: 0,
        },
      ],
    });

    expect(result.endDate).toBe('2028-02-29');
    expect(result.teachers[0]?.days[0]?.status).toBe('WORKED');
    expect(result.teachers[0]).not.toHaveProperty('finalPerformancePay');
  });

  it('rejects report values that would delegate calculation to a template', () => {
    expect(
      MonthlyReportPreviewSchema.safeParse({
        year: 2028,
        month: 2,
        startDate: '2028-02-01',
        endDate: '2028-02-29',
        generatedAt: '2028-03-01T00:00:00.000Z',
        teachers: [],
        formula: '=SUM(A1:A29)',
      }).success,
    ).toBe(false);
  });

  it('represents schedule gaps as non-blocking readiness warnings', () => {
    const warning = MonthlyReportReadinessSchema.parse({
      status: 'READY_WITH_WARNINGS',
      year: 2026,
      month: 9,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      issues: [
        {
          code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
          source: 'SECURITY_SCHEDULE',
          missingRanges: [
            { startDate: '2026-09-01', endDate: '2026-09-06' },
          ],
        },
      ],
    });

    expect(warning.status).toBe('READY_WITH_WARNINGS');
    expect(warning.issues[0]?.missingRanges[0]).toEqual({
      startDate: '2026-09-01',
      endDate: '2026-09-06',
    });
    expect(
      MonthlyReportReadinessSchema.safeParse({
        ...warning,
        status: 'READY',
      }).success,
    ).toBe(false);
  });

  it('keeps unavailable configuration distinct from a zero-valued workday', () => {
    const days: Array<Record<string, unknown>> = Array.from(
      { length: 30 },
      (_, index) => ({
        workDate: `2026-09-${String(index + 1).padStart(2, '0')}`,
        scheduleType: null,
        status: 'NON_WORKING_DAY',
        attendanceId: null,
        checkInAt: null,
        checkOutAt: null,
        workStart: null,
        workEnd: null,
        targetMinutes: 0,
        workedMinutes: 0,
        arrivalLateMinutes: 0,
        workDeficitMinutes: 0,
        leaveType: null,
        calendarExceptionName: null,
      }),
    );
    days[0] = {
      ...days[0],
      status: 'CONFIGURATION_MISSING',
      targetMinutes: null,
      workedMinutes: null,
      arrivalLateMinutes: null,
      workDeficitMinutes: null,
    };

    const result = MonthlyReportPreviewSchema.parse({
      year: 2026,
      month: 9,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      generatedAt: '2026-10-01T00:00:00.000Z',
      documentStatus: 'DRAFT',
      issues: [{
        category: 'CONFIGURATION',
        code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
        source: 'SECURITY_SCHEDULE',
        missingRanges: [{ startDate: '2026-09-01', endDate: '2026-09-01' }],
      }],
      teachers: [{
        teacherId: '50000000-0000-4000-8000-000000000001',
        teacherNip: 'SATPAM-1',
        teacherFullName: 'Satpam Satu',
        role: 'SECURITY_GUARD',
        days,
        totalWorkDeficitMinutes: 0,
        lateDayCount: 0,
        absentDayCount: 0,
        rejectedEarlyDepartureMinutes: 0,
      }],
    });

    expect(result.documentStatus).toBe('DRAFT');
    expect(result.teachers[0]?.days[0]).toMatchObject({
      status: 'CONFIGURATION_MISSING',
      targetMinutes: null,
      workDeficitMinutes: null,
    });
  });
});
