import type { LeaveStatus, LeaveType } from '@absensi/contracts';

export const OperationalAction = {
  CHECK_IN: 'CHECK_IN',
  CHECKOUT: 'CHECKOUT',
  EARLY_DEPARTURE: 'EARLY_DEPARTURE',
  CREATE_LEAVE: 'CREATE_LEAVE',
} as const;

export type OperationalAction = typeof OperationalAction[keyof typeof OperationalAction];
export type OperationalLeavePhase = 'SINGLE_DAY' | 'FULL_LEAVE' | 'EARLY_DEPARTURE';

export interface OperationalLeaveCandidate {
  leaveDate: string;
  leaveType: LeaveType;
  status: LeaveStatus;
  fullLeaveEndDate: string | null;
  earlyDepartureStartDate: string | null;
  earlyDepartureEndDate: string | null;
}

export interface OperationalLeaveBlock {
  leaveType: Exclude<LeaveType, 'LATE_ARRIVAL'>;
  status: 'PENDING' | 'APPROVED';
  phase: OperationalLeavePhase;
  blockedActions: OperationalAction[];
}

const ALL_ACTIONS: OperationalAction[] = [
  OperationalAction.CHECK_IN,
  OperationalAction.CHECKOUT,
  OperationalAction.EARLY_DEPARTURE,
  OperationalAction.CREATE_LEAVE,
];

export function resolveOperationalLeaveBlock(
  leaves: OperationalLeaveCandidate[],
  workDate: string,
): OperationalLeaveBlock | null {
  for (const leave of leaves) {
    if (leave.status !== 'PENDING' && leave.status !== 'APPROVED') continue;
    if (leave.leaveType === 'LATE_ARRIVAL') continue;
    if (leave.leaveType !== 'MATERNITY_LEAVE') {
      if (leave.leaveDate === workDate) {
        return { leaveType: leave.leaveType, status: leave.status, phase: 'SINGLE_DAY', blockedActions: ALL_ACTIONS };
      }
      continue;
    }
    if (leave.fullLeaveEndDate && workDate >= leave.leaveDate && workDate <= leave.fullLeaveEndDate) {
      return { leaveType: leave.leaveType, status: leave.status, phase: 'FULL_LEAVE', blockedActions: ALL_ACTIONS };
    }
    if (leave.status === 'APPROVED' && leave.earlyDepartureStartDate && leave.earlyDepartureEndDate &&
      workDate >= leave.earlyDepartureStartDate && workDate <= leave.earlyDepartureEndDate) {
      return { leaveType: leave.leaveType, status: leave.status, phase: 'EARLY_DEPARTURE', blockedActions: [OperationalAction.CHECKOUT, OperationalAction.EARLY_DEPARTURE] };
    }
  }
  return null;
}

export function assertOperationalActionAllowed(
  block: OperationalLeaveBlock | null,
  action: OperationalAction,
): void {
  if (!block?.blockedActions.includes(action)) return;
  throw new Error(`OPERATION_BLOCKED:${action}`);
}
