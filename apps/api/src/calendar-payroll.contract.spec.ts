import {
  CalendarExceptionInputSchema,
  CreatePayrollVersionRequestSchema,
  PayrollRuleSchema,
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

  it('requires the approved month-start payroll policy with a valid minimum', () => {
    expect(
      CreatePayrollVersionRequestSchema.parse({
        effectiveFrom: '2026-09-01',
        basePerformancePay: 600_000,
        minimumPerformancePay: 300_000,
        lateDeductionAmount: 10_000,
        absentDeductionAmount: 20_000,
        rejectedEarlyDepartureRatePerHour: 10_000,
      }),
    ).toMatchObject({ effectiveFrom: '2026-09-01' });
    expect(
      CreatePayrollVersionRequestSchema.safeParse({
        effectiveFrom: '2026-09-02',
        basePerformancePay: 600_000,
        minimumPerformancePay: 700_000,
        lateDeductionAmount: 10_000,
        absentDeductionAmount: 20_000,
        rejectedEarlyDepartureRatePerHour: 10_000,
      }).success,
    ).toBe(false);
  });

  it('keeps legacy and monthly payroll fields mutually exclusive', () => {
    const common = {
      id: '30000000-0000-4000-8000-000000000001',
      basePerformancePay: 600_000,
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
    };
    expect(
      PayrollRuleSchema.safeParse({
        ...common,
        calculationMode: 'MONTHLY_POLICY',
        minimumPerformancePay: 300_000,
        deductionRatePerMinute: 1,
        lateDeductionAmount: 10_000,
        absentDeductionAmount: 20_000,
        rejectedEarlyDepartureRatePerHour: 10_000,
      }).success,
    ).toBe(false);
    expect(
      PayrollRuleSchema.safeParse({
        ...common,
        calculationMode: 'LEGACY_PER_MINUTE',
        minimumPerformancePay: 0,
        deductionRatePerMinute: 1_000,
        lateDeductionAmount: 10_000,
        absentDeductionAmount: 0,
        rejectedEarlyDepartureRatePerHour: 0,
      }).success,
    ).toBe(false);
  });
});
