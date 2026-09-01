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

const MAX_DAILY_DEDUCTION_IN_CENTS = 20_000 * 100;

export function calculatePerformancePay(input: {
  totalWorkDeficitMinutes: number;
  days: readonly {
    status: 'WORKED' | 'INCOMPLETE' | 'LEAVE' | 'ABSENT' | 'NON_WORKING_DAY';
    arrivalLateMinutes: number;
    rejectedEarlyDepartureMinutes: number;
  }[];
  payrollRule: PayrollRule;
}): PerformancePayCalculation {
  const ruleFields = {
    calculationMode: input.payrollRule.calculationMode,
    basePerformancePay: input.payrollRule.basePerformancePay,
    minimumPerformancePay: input.payrollRule.minimumPerformancePay,
    deductionRatePerMinute: input.payrollRule.deductionRatePerMinute,
    lateDeductionAmount: input.payrollRule.lateDeductionAmount,
    absentDeductionAmount: input.payrollRule.absentDeductionAmount,
    rejectedEarlyDepartureRatePerHour:
      input.payrollRule.rejectedEarlyDepartureRatePerHour,
  };
  if (input.payrollRule.calculationMode === 'LEGACY_PER_MINUTE') {
    const deductionAmountInCents =
      input.totalWorkDeficitMinutes *
      toCents(input.payrollRule.deductionRatePerMinute);
    const basePerformancePayInCents = toCents(
      input.payrollRule.basePerformancePay,
    );
    return PerformancePayCalculationSchema.parse({
      totalWorkDeficitMinutes: input.totalWorkDeficitMinutes,
      lateDayCount: 0,
      absentDayCount: 0,
      rejectedEarlyDepartureMinutes: 0,
      ...ruleFields,
      lateDeductionTotal: 0,
      absentDeductionTotal: 0,
      rejectedEarlyDepartureDeductionTotal: 0,
      deductionAmount: deductionAmountInCents / 100,
      finalPerformancePay:
        (basePerformancePayInCents - deductionAmountInCents) / 100,
    });
  }

  const basePerformancePayInCents = toCents(input.payrollRule.basePerformancePay);
  const minimumPerformancePayInCents = toCents(
    input.payrollRule.minimumPerformancePay,
  );
  const maximumMonthlyDeductionInCents = Math.max(
    0,
    basePerformancePayInCents - minimumPerformancePayInCents,
  );
  const lateDeductionInCents = toCents(input.payrollRule.lateDeductionAmount);
  const absentDeductionInCents = toCents(input.payrollRule.absentDeductionAmount);
  const earlyRateInCents = toCents(
    input.payrollRule.rejectedEarlyDepartureRatePerHour,
  );
  let lateDayCount = 0;
  let absentDayCount = 0;
  let rejectedEarlyDepartureMinutes = 0;
  let lateDeductionTotalInCents = 0;
  let absentDeductionTotalInCents = 0;
  let rejectedEarlyDepartureDeductionTotalInCents = 0;
  let appliedMonthlyDeductionInCents = 0;

  for (const day of input.days) {
    const monthlyRemaining =
      maximumMonthlyDeductionInCents - appliedMonthlyDeductionInCents;

    if (day.status === 'ABSENT') {
      absentDayCount += 1;
      const applied = Math.min(
        absentDeductionInCents,
        MAX_DAILY_DEDUCTION_IN_CENTS,
        monthlyRemaining,
      );
      absentDeductionTotalInCents += applied;
      appliedMonthlyDeductionInCents += applied;
      continue;
    }
    if (day.status !== 'WORKED' && day.status !== 'INCOMPLETE') continue;

    const dayCapInCents = MAX_DAILY_DEDUCTION_IN_CENTS;
    let dayAppliedInCents = 0;
    if (day.arrivalLateMinutes > 0) {
      lateDayCount += 1;
      const applied = Math.min(
        lateDeductionInCents,
        dayCapInCents,
        monthlyRemaining,
      );
      lateDeductionTotalInCents += applied;
      dayAppliedInCents += applied;
    }

    if (day.rejectedEarlyDepartureMinutes > 0) {
      rejectedEarlyDepartureMinutes += day.rejectedEarlyDepartureMinutes;
      const calculated = Math.round(
        (day.rejectedEarlyDepartureMinutes * earlyRateInCents) / 60,
      );
      const applied = Math.min(
        calculated,
        Math.max(0, dayCapInCents - dayAppliedInCents),
        Math.max(0, monthlyRemaining - dayAppliedInCents),
      );
      rejectedEarlyDepartureDeductionTotalInCents += applied;
      dayAppliedInCents += applied;
    }
    appliedMonthlyDeductionInCents += dayAppliedInCents;
  }

  return PerformancePayCalculationSchema.parse({
    totalWorkDeficitMinutes: input.totalWorkDeficitMinutes,
    lateDayCount,
    absentDayCount,
    rejectedEarlyDepartureMinutes,
    ...ruleFields,
    lateDeductionTotal: lateDeductionTotalInCents / 100,
    absentDeductionTotal: absentDeductionTotalInCents / 100,
    rejectedEarlyDepartureDeductionTotal:
      rejectedEarlyDepartureDeductionTotalInCents / 100,
    deductionAmount: appliedMonthlyDeductionInCents / 100,
    finalPerformancePay:
      (basePerformancePayInCents - appliedMonthlyDeductionInCents) / 100,
  });
}
