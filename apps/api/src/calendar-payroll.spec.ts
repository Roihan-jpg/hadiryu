import type { CalendarException, PayrollRule } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import {
  calculatePerformancePay,
  resolveCalendarDay,
  resolvePayrollRule,
} from './calendar-payroll.js';

const holiday: CalendarException = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-12-25',
  exceptionType: 'HOLIDAY',
  name: 'Libur Natal',
  scheduleType: null,
};

const payrollRules: PayrollRule[] = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    calculationMode: 'LEGACY_PER_MINUTE',
    basePerformancePay: 1_000_000,
    minimumPerformancePay: 0,
    deductionRatePerMinute: 2500,
    lateDeductionAmount: 0,
    absentDeductionAmount: 0,
    rejectedEarlyDepartureRatePerHour: 0,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-08-31',
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    calculationMode: 'LEGACY_PER_MINUTE',
    basePerformancePay: 1_200_000,
    minimumPerformancePay: 0,
    deductionRatePerMinute: 3000,
    lateDeductionAmount: 0,
    absentDeductionAmount: 0,
    rejectedEarlyDepartureRatePerHour: 0,
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
  },
];

describe('calendar and payroll resolvers', () => {
  it('resolves a holiday, special Sunday workday, Saturday, weekday, and Sunday', () => {
    expect(resolveCalendarDay('2026-12-25', holiday)).toMatchObject({
      isWorkingDay: false,
      scheduleType: null,
      exception: holiday,
    });
    expect(
      resolveCalendarDay('2026-08-16', {
        ...holiday,
        workDate: '2026-08-16',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
      }),
    ).toMatchObject({ isWorkingDay: true, scheduleType: 'SATURDAY' });
    expect(resolveCalendarDay('2026-08-22', null)).toMatchObject({
      isWorkingDay: true,
      scheduleType: 'SATURDAY',
    });
    expect(resolveCalendarDay('2026-08-24', null)).toMatchObject({
      isWorkingDay: true,
      scheduleType: 'WEEKDAY',
    });
    expect(resolveCalendarDay('2026-08-23', null)).toMatchObject({
      isWorkingDay: false,
      scheduleType: null,
    });
  });

  it('resolves the global rule effective on the requested historical month', () => {
    expect(resolvePayrollRule(payrollRules, '2026-08-01')?.id).toBe(
      payrollRules[0]!.id,
    );
    expect(resolvePayrollRule(payrollRules, '2026-09-01')?.id).toBe(
      payrollRules[1]!.id,
    );
  });

  it('calculates deductions in cents and permits negative final pay', () => {
    expect(
      calculatePerformancePay({
        totalWorkDeficitMinutes: 500,
        days: [],
        payrollRule: payrollRules[1]!,
      }),
    ).toEqual({
      totalWorkDeficitMinutes: 500,
      lateDayCount: 0,
      absentDayCount: 0,
      rejectedEarlyDepartureMinutes: 0,
      calculationMode: 'LEGACY_PER_MINUTE',
      basePerformancePay: 1_200_000,
      minimumPerformancePay: 0,
      deductionRatePerMinute: 3000,
      lateDeductionAmount: 0,
      absentDeductionAmount: 0,
      rejectedEarlyDepartureRatePerHour: 0,
      lateDeductionTotal: 0,
      absentDeductionTotal: 0,
      rejectedEarlyDepartureDeductionTotal: 0,
      deductionAmount: 1_500_000,
      finalPerformancePay: -300_000,
    });
  });

  it('applies the approved monthly policy per day and floors pay at Rp300.000', () => {
    const policy: PayrollRule = {
      id: '30000000-0000-4000-8000-000000000003',
      calculationMode: 'MONTHLY_POLICY',
      basePerformancePay: 600_000,
      minimumPerformancePay: 300_000,
      deductionRatePerMinute: 0,
      lateDeductionAmount: 10_000,
      absentDeductionAmount: 20_000,
      rejectedEarlyDepartureRatePerHour: 10_000,
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
    };

    expect(
      calculatePerformancePay({
        totalWorkDeficitMinutes: 605,
        payrollRule: policy,
        days: [
          { status: 'WORKED', arrivalLateMinutes: 5, rejectedEarlyDepartureMinutes: 90 },
          { status: 'ABSENT', arrivalLateMinutes: 0, rejectedEarlyDepartureMinutes: 0 },
          { status: 'INCOMPLETE', arrivalLateMinutes: 10, rejectedEarlyDepartureMinutes: 0 },
        ],
      }),
    ).toMatchObject({
      lateDayCount: 2,
      absentDayCount: 1,
      rejectedEarlyDepartureMinutes: 90,
      lateDeductionTotal: 20_000,
      absentDeductionTotal: 20_000,
      rejectedEarlyDepartureDeductionTotal: 10_000,
      deductionAmount: 50_000,
      finalPerformancePay: 550_000,
    });

    const floored = calculatePerformancePay({
        totalWorkDeficitMinutes: 0,
        payrollRule: policy,
        days: Array.from({ length: 31 }, () => ({
          status: 'ABSENT' as const,
          arrivalLateMinutes: 0,
          rejectedEarlyDepartureMinutes: 0,
        })),
      });
    expect(floored.finalPerformancePay).toBe(300_000);
    expect(floored.absentDayCount).toBe(31);
  });

  it('keeps the approved daily deduction cap at Rp20.000 when configurable amounts are higher', () => {
    const policy: PayrollRule = {
      id: '30000000-0000-4000-8000-000000000004',
      calculationMode: 'MONTHLY_POLICY',
      basePerformancePay: 600_000,
      minimumPerformancePay: 300_000,
      deductionRatePerMinute: 0,
      lateDeductionAmount: 15_000,
      absentDeductionAmount: 25_000,
      rejectedEarlyDepartureRatePerHour: 15_000,
      effectiveFrom: '2027-01-01',
      effectiveTo: null,
    };

    expect(
      calculatePerformancePay({
        totalWorkDeficitMinutes: 635,
        payrollRule: policy,
        days: [
          { status: 'ABSENT', arrivalLateMinutes: 0, rejectedEarlyDepartureMinutes: 0 },
          { status: 'WORKED', arrivalLateMinutes: 5, rejectedEarlyDepartureMinutes: 120 },
        ],
      }),
    ).toMatchObject({
      absentDeductionTotal: 20_000,
      lateDeductionTotal: 15_000,
      rejectedEarlyDepartureDeductionTotal: 5_000,
      deductionAmount: 40_000,
      finalPerformancePay: 560_000,
    });
  });
});
