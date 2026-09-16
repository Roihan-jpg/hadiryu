function addCalendarMonths(workDate: string, months: number): string {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1 + months, day!))
    .toISOString()
    .slice(0, 10);
}

function addCalendarDays(workDate: string, days: number): string {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days))
    .toISOString()
    .slice(0, 10);
}

export interface MaternityLeavePeriods {
  fullLeaveStartDate: string;
  fullLeaveEndDate: string;
  earlyDepartureStartDate: string;
  earlyDepartureEndDate: string;
}

export interface MaternityLeaveEntitlement {
  status: 'PENDING' | 'APPROVED';
  fullLeaveEndDate: string;
  earlyDepartureStartDate: string;
  earlyDepartureEndDate: string;
}

export type MaternityLeavePhase = 'FULL_LEAVE' | 'EARLY_DEPARTURE';

export function maternityLeavePeriods(filedDate: string): MaternityLeavePeriods {
  const fullLeaveEndDate = addCalendarDays(addCalendarMonths(filedDate, 2), -1);
  const earlyDepartureStartDate = addCalendarDays(fullLeaveEndDate, 1);
  return {
    fullLeaveStartDate: filedDate,
    fullLeaveEndDate,
    earlyDepartureStartDate,
    earlyDepartureEndDate: addCalendarDays(addCalendarMonths(earlyDepartureStartDate, 24), -1),
  };
}

export function isWithinDateRange(workDate: string, startDate: string, endDate: string): boolean {
  return workDate >= startDate && workDate <= endDate;
}

export function maternityLeavePhase(
  entitlement: MaternityLeaveEntitlement,
  workDate: string,
): MaternityLeavePhase | null {
  if (workDate <= entitlement.fullLeaveEndDate) return 'FULL_LEAVE';
  return isWithinDateRange(workDate, entitlement.earlyDepartureStartDate, entitlement.earlyDepartureEndDate)
    ? 'EARLY_DEPARTURE'
    : null;
}
