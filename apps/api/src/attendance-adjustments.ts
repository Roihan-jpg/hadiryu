export type LateArrivalPermissionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | null;

export type EarlyDeparturePermissionStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | null;

export interface AttendanceAdjustmentContext {
  lateArrivalStatus?: LateArrivalPermissionStatus;
  earlyDepartureStatus?: EarlyDeparturePermissionStatus;
}

export interface AdjustableAttendanceMetrics {
  workDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  workStart: string;
  workEnd: string;
  workStartAt?: string;
  workEndAt?: string;
  targetMinutes: number;
  workedMinutes: number | null;
  workDeficitMinutes: number | null;
  arrivalLateMinutes: number;
  status: 'CHECKED_IN' | 'COMPLETED' | 'INCOMPLETE';
}

export interface EffectiveAttendanceMetrics {
  workedMinutes: number | null;
  workDeficitMinutes: number | null;
  arrivalLateMinutes: number;
}

function addLocalDay(workDate: string): string {
  const date = new Date(`${workDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function scheduledInstant(
  attendance: AdjustableAttendanceMetrics,
  boundary: 'START' | 'END',
): Date {
  const snapshot = boundary === 'START' ? attendance.workStartAt : attendance.workEndAt;
  if (snapshot) return new Date(snapshot);
  const time = boundary === 'START' ? attendance.workStart : attendance.workEnd;
  const workDate = boundary === 'END' && attendance.workEnd <= attendance.workStart
    ? addLocalDay(attendance.workDate)
    : attendance.workDate;
  return new Date(`${workDate}T${time}:00+07:00`);
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
}

export function adjustedAttendanceMetrics(
  attendance: AdjustableAttendanceMetrics,
  context: AttendanceAdjustmentContext,
): EffectiveAttendanceMetrics {
  const hasLateArrivalCredit =
    context.lateArrivalStatus === 'PENDING' ||
    context.lateArrivalStatus === 'APPROVED';
  const arrivalLateMinutes = hasLateArrivalCredit ? 0 : attendance.arrivalLateMinutes;

  if (
    attendance.status !== 'COMPLETED' ||
    attendance.checkOutAt === null ||
    attendance.workedMinutes === null ||
    attendance.workDeficitMinutes === null
  ) {
    return {
      workedMinutes: attendance.workedMinutes,
      workDeficitMinutes: attendance.workDeficitMinutes,
      arrivalLateMinutes,
    };
  }

  const checkOutAt = new Date(attendance.checkOutAt);
  let workedMinutes = hasLateArrivalCredit
    ? minutesBetween(scheduledInstant(attendance, 'START'), checkOutAt)
    : attendance.workedMinutes;

  if (context.earlyDepartureStatus === 'APPROVED') {
    workedMinutes += minutesBetween(checkOutAt, scheduledInstant(attendance, 'END'));
  }

  return {
    workedMinutes,
    workDeficitMinutes: Math.max(0, attendance.targetMinutes - workedMinutes),
    arrivalLateMinutes,
  };
}
