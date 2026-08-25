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
    basePerformancePay: 1_000_000,
    deductionRatePerMinute: 2500,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-08-31',
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    basePerformancePay: 1_200_000,
    deductionRatePerMinute: 3000,
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
        payrollRule: payrollRules[1]!,
      }),
    ).toEqual({
      totalWorkDeficitMinutes: 500,
      basePerformancePay: 1_200_000,
      deductionRatePerMinute: 3000,
      deductionAmount: 1_500_000,
      finalPerformancePay: -300_000,
    });
  });
});
