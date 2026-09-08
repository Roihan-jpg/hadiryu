import type {
  OvernightScheduleRuleInput,
  ScheduleRuleInput,
  SecurityRoster,
  SecurityRotationPreviewItem,
} from '@absensi/contracts';

export type SecurityAssignmentStatus = 'DAY' | 'NIGHT' | 'OFF' | 'UNASSIGNED';

export interface SecurityAssignment {
  rotationDay: 1 | 2 | 3;
  status: SecurityAssignmentStatus;
}

export interface ShiftBoundaries {
  checkInOpenAt: string;
  workStartAt: string;
  checkInCloseAt: string;
  checkoutOpenAt: string;
  workEndAt: string;
  checkoutCloseAt: string;
}

const rotations = [
  ['dayOneMorningGuardId', 'dayOneNightGuardId', 'dayOneOffGuardId'],
  ['dayOneOffGuardId', 'dayOneMorningGuardId', 'dayOneNightGuardId'],
  ['dayOneNightGuardId', 'dayOneOffGuardId', 'dayOneMorningGuardId'],
] as const;

function dateNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function addLocalDays(workDate: string, days: number): string {
  return new Date(dateNumber(workDate) + days * 86_400_000).toISOString().slice(0, 10);
}

export function securityRotationDay(effectiveFrom: string, workDate: string): 1 | 2 | 3 {
  const elapsedDays = Math.floor((dateNumber(workDate) - dateNumber(effectiveFrom)) / 86_400_000);
  return ((((elapsedDays % 3) + 3) % 3) + 1) as 1 | 2 | 3;
}

export function resolveSecurityAssignment(
  roster: SecurityRoster,
  workDate: string,
  guardId: string,
): SecurityAssignment {
  const rotationDay = securityRotationDay(roster.effectiveFrom, workDate);
  const [morningKey, nightKey, offKey] = rotations[rotationDay - 1]!;
  const status = roster[morningKey] === guardId
    ? 'DAY'
    : roster[nightKey] === guardId
      ? 'NIGHT'
      : roster[offKey] === guardId
        ? 'OFF'
        : 'UNASSIGNED';
  return { rotationDay, status };
}

function jakartaInstant(workDate: string, time: string): string {
  return new Date(`${workDate}T${time}:00+07:00`).toISOString();
}

export function buildSecurityShiftBoundaries(
  workDate: string,
  schedule: ScheduleRuleInput | OvernightScheduleRuleInput,
  scheduleType: 'SECURITY_DAY' | 'SECURITY_NIGHT',
): ShiftBoundaries {
  const checkoutDate = scheduleType === 'SECURITY_NIGHT' ? addLocalDays(workDate, 1) : workDate;
  return {
    checkInOpenAt: jakartaInstant(workDate, schedule.checkInOpen),
    workStartAt: jakartaInstant(workDate, schedule.workStart),
    checkInCloseAt: jakartaInstant(workDate, schedule.checkInClose),
    checkoutOpenAt: jakartaInstant(checkoutDate, schedule.checkoutOpen),
    workEndAt: jakartaInstant(checkoutDate, schedule.workEnd),
    checkoutCloseAt: jakartaInstant(checkoutDate, schedule.checkoutClose),
  };
}

export function securityRotationPreview(
  roster: SecurityRoster,
  startDate: string,
): SecurityRotationPreviewItem[] {
  return [0, 1, 2].map((offset) => {
    const workDate = addLocalDays(startDate, offset);
    const rotationDay = securityRotationDay(roster.effectiveFrom, workDate);
    const [morningKey, nightKey, offKey] = rotations[rotationDay - 1]!;
    return {
      workDate,
      rotationDay,
      morningGuardId: roster[morningKey],
      nightGuardId: roster[nightKey],
      offGuardId: roster[offKey],
    };
  });
}
