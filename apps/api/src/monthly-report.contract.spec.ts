import {
  MonthlyReportParamsSchema,
  MonthlyReportPreviewSchema,
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
      teachers: [
        {
          teacherId: '50000000-0000-4000-8000-000000000001',
          teacherNip: '1987001',
          teacherFullName: 'Guru Satu',
          days,
          totalWorkDeficitMinutes: 0,
          basePerformancePay: 1_200_000,
          deductionRatePerMinute: 3000,
          deductionAmount: 0,
          finalPerformancePay: 1_200_000,
        },
      ],
    });

    expect(result.endDate).toBe('2028-02-29');
    expect(result.teachers[0]?.days[0]?.status).toBe('WORKED');
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
});
