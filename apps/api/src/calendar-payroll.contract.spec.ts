import {
  CalendarExceptionInputSchema,
  CreatePayrollVersionRequestSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('calendar-payroll contracts', () => {
  it('accepts holidays and working-day overrides, but never a per-teacher setting', () => {
    expect(
      CalendarExceptionInputSchema.parse({
        workDate: '2026-12-25',
        exceptionType: 'HOLIDAY',
        name: 'Libur Natal',
        scheduleType: null,
      }),
    ).toMatchObject({ exceptionType: 'HOLIDAY', scheduleType: null });
    expect(
      CalendarExceptionInputSchema.parse({
        workDate: '2026-08-17',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
      }),
    ).toMatchObject({ exceptionType: 'WORKING_DAY', scheduleType: 'SATURDAY' });
    expect(
      CalendarExceptionInputSchema.safeParse({
        workDate: '2026-08-17',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
        teacherId: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
      }).success,
    ).toBe(false);
  });

  it('requires a month-start global payroll version with two-decimal money', () => {
    expect(
      CreatePayrollVersionRequestSchema.parse({
        effectiveFrom: '2026-09-01',
        basePerformancePay: 1_500_000,
        deductionRatePerMinute: 2500.5,
      }),
    ).toMatchObject({ effectiveFrom: '2026-09-01' });
    expect(
      CreatePayrollVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-02',
        basePerformancePay: 1_500_000.001,
        deductionRatePerMinute: -1,
      }).success,
    ).toBe(false);
  });
});
