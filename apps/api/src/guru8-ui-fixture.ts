export const GURU8_UI_FIXTURE_START = '2026-08-14';
export const GURU8_UI_FIXTURE_END = '2026-09-12';
export const GURU8_HOSTED_UI_FIXTURE_START = '2026-08-31';
export const GURU8_HOSTED_UI_FIXTURE_END = '2026-09-12';
const HOSTED_GURU8_UI_FIXTURE_URL = 'https://jlqzeytwwdnooepagknb.supabase.co';

export type Guru8UiFixtureTarget = 'local' | 'hosted';

export type FixtureLeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type FixtureEarlyDepartureStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Guru8FixtureAttendance {
  workDate: string;
  arrivalLateMinutes: number;
  earlyDepartureStatus: FixtureEarlyDepartureStatus | null;
}

export interface Guru8FixtureLeave {
  workDate: string;
  leaveType: 'SICK' | 'LATE_ARRIVAL';
  status: FixtureLeaveStatus;
}

export interface Guru8FixtureEarlyDeparture {
  workDate: string;
  status: FixtureEarlyDepartureStatus;
}

export interface Guru8UiFixture {
  startDate: string;
  endDate: string;
  attendances: Guru8FixtureAttendance[];
  leaves: Guru8FixtureLeave[];
  earlyDepartures: Guru8FixtureEarlyDeparture[];
}

const FINAL_STREAK_DATES = [
  '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-31',
  '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
  '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12',
] as const;

export function buildGuru8UiFixture(
  target: Guru8UiFixtureTarget = 'local',
): Guru8UiFixture {
  if (target === 'hosted') {
    return {
      startDate: GURU8_HOSTED_UI_FIXTURE_START,
      endDate: GURU8_HOSTED_UI_FIXTURE_END,
      attendances: [
        { workDate: '2026-08-31', arrivalLateMinutes: 0, earlyDepartureStatus: null },
        { workDate: '2026-09-07', arrivalLateMinutes: 0, earlyDepartureStatus: 'APPROVED' },
        { workDate: '2026-09-08', arrivalLateMinutes: 0, earlyDepartureStatus: 'REJECTED' },
        { workDate: '2026-09-09', arrivalLateMinutes: 0, earlyDepartureStatus: 'PENDING' },
        { workDate: '2026-09-10', arrivalLateMinutes: 5, earlyDepartureStatus: null },
        { workDate: '2026-09-11', arrivalLateMinutes: 0, earlyDepartureStatus: null },
        { workDate: '2026-09-12', arrivalLateMinutes: 0, earlyDepartureStatus: null },
      ],
      leaves: [
        { workDate: '2026-09-01', leaveType: 'LATE_ARRIVAL', status: 'APPROVED' },
        { workDate: '2026-09-02', leaveType: 'LATE_ARRIVAL', status: 'REJECTED' },
        { workDate: '2026-09-03', leaveType: 'SICK', status: 'APPROVED' },
        { workDate: '2026-09-04', leaveType: 'LATE_ARRIVAL', status: 'CANCELLED' },
        { workDate: '2026-09-05', leaveType: 'LATE_ARRIVAL', status: 'PENDING' },
      ],
      earlyDepartures: [
        { workDate: '2026-09-07', status: 'APPROVED' },
        { workDate: '2026-09-08', status: 'REJECTED' },
        { workDate: '2026-09-09', status: 'PENDING' },
      ],
    };
  }
  return {
    startDate: GURU8_UI_FIXTURE_START,
    endDate: GURU8_UI_FIXTURE_END,
    attendances: [
      { workDate: '2026-08-14', arrivalLateMinutes: 0, earlyDepartureStatus: null },
      { workDate: '2026-08-17', arrivalLateMinutes: 0, earlyDepartureStatus: 'APPROVED' },
      { workDate: '2026-08-19', arrivalLateMinutes: 0, earlyDepartureStatus: 'REJECTED' },
      { workDate: '2026-08-21', arrivalLateMinutes: 0, earlyDepartureStatus: null },
      { workDate: '2026-08-22', arrivalLateMinutes: 0, earlyDepartureStatus: 'PENDING' },
      { workDate: '2026-08-26', arrivalLateMinutes: 5, earlyDepartureStatus: null },
      ...FINAL_STREAK_DATES.map((workDate) => ({
        workDate,
        arrivalLateMinutes: 0,
        earlyDepartureStatus: null,
      })),
    ],
    leaves: [
      { workDate: '2026-08-15', leaveType: 'LATE_ARRIVAL', status: 'APPROVED' },
      { workDate: '2026-08-18', leaveType: 'LATE_ARRIVAL', status: 'REJECTED' },
      { workDate: '2026-08-20', leaveType: 'SICK', status: 'APPROVED' },
      { workDate: '2026-08-24', leaveType: 'LATE_ARRIVAL', status: 'CANCELLED' },
      { workDate: '2026-08-25', leaveType: 'LATE_ARRIVAL', status: 'PENDING' },
    ],
    earlyDepartures: [
      { workDate: '2026-08-17', status: 'APPROVED' },
      { workDate: '2026-08-19', status: 'REJECTED' },
      { workDate: '2026-08-22', status: 'PENDING' },
    ],
  };
}

export function isLocalSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

export function isGuru8UiFixtureTargetUrl(
  target: Guru8UiFixtureTarget,
  value: string,
): boolean {
  return target === 'local'
    ? isLocalSupabaseUrl(value)
    : value === HOSTED_GURU8_UI_FIXTURE_URL;
}
