import {
  CalendarDayResolutionSchema,
  PayrollSettingsResponseSchema,
  PerformancePayCalculationSchema,
  type CalendarDayResolution,
  type CalendarException,
  type PayrollRule,
  type PayrollSettingsResponse,
  type PerformancePayCalculation,
} from '@absensi/contracts';

interface EffectiveVersion {
  effectiveFrom: string;
  effectiveTo: string | null;
}

function resolveEffectiveVersion<T extends EffectiveVersion>(
  versions: readonly T[],
  effectiveOn: string,
): T | null {
  return (
    versions
      .filter(
        (version) =>
          version.effectiveFrom <= effectiveOn &&
          (version.effectiveTo === null || effectiveOn <= version.effectiveTo),
      )
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ??
    null
  );
}

function weekday(workDate: string): number {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function resolveCalendarDay(
  workDate: string,
  exception: CalendarException | null,
): CalendarDayResolution {
  if (exception?.exceptionType === 'HOLIDAY') {
    return CalendarDayResolutionSchema.parse({
      workDate,
      isWorkingDay: false,
      scheduleType: null,
      exception,
    });
  }
  if (exception?.exceptionType === 'WORKING_DAY') {
    return CalendarDayResolutionSchema.parse({
      workDate,
      isWorkingDay: true,
      scheduleType: exception.scheduleType,
      exception,
    });
  }
  const day = weekday(workDate);
  return CalendarDayResolutionSchema.parse({
    workDate,
    isWorkingDay: day !== 0,
    scheduleType: day === 0 ? null : day === 6 ? 'SATURDAY' : 'WEEKDAY',
    exception: null,
  });
}

export function resolvePayrollRule(
  versions: readonly PayrollRule[],
  effectiveOn: string,
): PayrollRule | null {
  return resolveEffectiveVersion(versions, effectiveOn);
}

export function resolvePayrollSettings(
  versions: readonly PayrollRule[],
  effectiveOn: string,
): PayrollSettingsResponse {
  return PayrollSettingsResponseSchema.parse({
    effectiveOn,
    payrollRule: resolvePayrollRule(versions, effectiveOn),
  });
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

export function calculatePerformancePay(input: {
  totalWorkDeficitMinutes: number;
  payrollRule: PayrollRule;
}): PerformancePayCalculation {
  const deductionAmountInCents =
    input.totalWorkDeficitMinutes * toCents(input.payrollRule.deductionRatePerMinute);
  const basePerformancePayInCents = toCents(input.payrollRule.basePerformancePay);
  return PerformancePayCalculationSchema.parse({
    totalWorkDeficitMinutes: input.totalWorkDeficitMinutes,
    basePerformancePay: input.payrollRule.basePerformancePay,
    deductionRatePerMinute: input.payrollRule.deductionRatePerMinute,
    deductionAmount: deductionAmountInCents / 100,
    finalPerformancePay: (basePerformancePayInCents - deductionAmountInCents) / 100,
  });
}
