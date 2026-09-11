import {
  StaffDashboardQuerySchema,
  StaffDashboardResponseSchema,
  type AuthUser,
  type DashboardActivity,
  type EarlyDepartureDashboardActivity,
  type LeaveStatus,
  type ScheduleType,
  type StaffDashboardQuery,
  type StaffDashboardResponse,
  type TeacherStreak,
} from '@absensi/contracts';
import type { Express, Request } from 'express';

import { AppError, createSessionGuard, requireRole, type AuthService } from './auth.js';
import { adjustedAttendanceMetrics, type EarlyDeparturePermissionStatus } from './attendance-adjustments.js';
import { jakartaDateTime, type AttendanceService } from './attendance.js';
import type { RequestQuotaService } from './request-quotas.js';
import type { SecurityDashboardService } from './security-dashboard.js';

export interface DashboardAttendanceSource {
  id: string;
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
  scheduleType: ScheduleType;
  lateArrivalStatus: LeaveStatus | null;
  earlyDepartureStatus: EarlyDeparturePermissionStatus;
}

export interface DashboardStreakDay {
  workDate: string;
  kind: 'WORKING' | 'PAUSE' | 'OPEN' | 'CONFIGURATION_MISSING';
  attendance: { actualLateMinutes: number; lateArrivalStatus: LeaveStatus | null } | null;
}

export interface StaffDashboardSource {
  attendances: DashboardAttendanceSource[];
  leaves: Extract<DashboardActivity, { type: 'LEAVE' }>[];
  earlyDepartures: EarlyDepartureDashboardActivity[];
  latestEarlyDeparture: EarlyDepartureDashboardActivity | null;
  streakDays: DashboardStreakDay[];
}

export interface StaffDashboardRepository {
  load(staff: Pick<AuthUser, 'id' | 'role'>, month: string, serverNow: Date): Promise<StaffDashboardSource>;
}

export interface StaffDashboardService {
  get(staff: AuthUser, input: StaffDashboardQuery): Promise<StaffDashboardResponse>;
}

function arrivalOffset(attendance: DashboardAttendanceSource): number {
  if (attendance.arrivalLateMinutes > 0) return -attendance.arrivalLateMinutes;
  if (!attendance.workStartAt) return 0;
  return Math.max(0, Math.floor(
    (new Date(attendance.workStartAt).getTime() - new Date(attendance.checkInAt).getTime()) / 60_000,
  ));
}

function toAttendanceActivity(attendance: DashboardAttendanceSource): Extract<DashboardActivity, { type: 'ATTENDANCE' }> {
  const effective = adjustedAttendanceMetrics(attendance, {
    lateArrivalStatus: attendance.lateArrivalStatus,
    earlyDepartureStatus: attendance.earlyDepartureStatus,
  });
  return {
    type: 'ATTENDANCE', id: attendance.id, workDate: attendance.workDate,
    occurredAt: attendance.checkOutAt ?? attendance.checkInAt,
    checkInAt: attendance.checkInAt, checkOutAt: attendance.checkOutAt,
    status: attendance.status, scheduleType: attendance.scheduleType,
    arrivalOffsetMinutes: arrivalOffset(attendance),
    actualLateMinutes: attendance.arrivalLateMinutes,
    effectiveLateMinutes: effective.arrivalLateMinutes,
    lateArrivalStatus: attendance.lateArrivalStatus,
    workedMinutes: effective.workedMinutes,
    workDeficitMinutes: effective.workDeficitMinutes,
  };
}

function streak(days: DashboardStreakDay[]): TeacherStreak {
  let currentDays = 0;
  let provisional = false;
  for (const day of days) {
    if (day.kind === 'CONFIGURATION_MISSING') {
      return { status: 'UNAVAILABLE', reason: 'CONFIGURATION_MISSING' };
    }
    if (day.kind === 'PAUSE' || day.kind === 'OPEN') continue;
    if (!day.attendance) break;
    const credited = day.attendance.lateArrivalStatus === 'PENDING' || day.attendance.lateArrivalStatus === 'APPROVED';
    if (day.attendance.actualLateMinutes > 0 && !credited) break;
    currentDays += 1;
    provisional ||= day.attendance.lateArrivalStatus === 'PENDING';
  }
  const tier = currentDays >= 14 ? 'PURPLE' : currentDays >= 7 ? 'BLUE' : currentDays >= 3 ? 'RED' : 'NONE';
  const nextMilestone = currentDays < 3 ? 3 : currentDays < 7 ? 7 : currentDays < 14 ? 14 : null;
  return {
    status: 'AVAILABLE', currentDays, tier, nextMilestone,
    daysRemaining: nextMilestone === null ? 0 : nextMilestone - currentDays,
    provisional,
  };
}

export function createStaffDashboardService(dependencies: {
  repository: StaffDashboardRepository;
  attendanceService: AttendanceService;
  requestQuotaService: RequestQuotaService;
  securityDashboardService?: SecurityDashboardService;
  now?: () => Date;
}): StaffDashboardService {
  const now = dependencies.now ?? (() => new Date());
  return {
    async get(staff, rawInput) {
      const input = StaffDashboardQuerySchema.parse(rawInput);
      const serverNow = now();
      const month = input.month ?? jakartaDateTime(serverNow).workDate.slice(0, 7);
      const [source, todayAttendance, requestQuotas, securityDuty] = await Promise.all([
        dependencies.repository.load(staff, month, serverNow),
        dependencies.attendanceService.getToday(staff),
        dependencies.requestQuotaService.get(staff.id, { month }),
        staff.role === 'SECURITY_GUARD' && dependencies.securityDashboardService
          ? dependencies.securityDashboardService.getDashboard(staff.id)
          : Promise.resolve(null),
      ]);
      const attendance = source.attendances.map(toAttendanceActivity);
      const metrics = {
        attendanceDays: attendance.length,
        onTimeDays: attendance.filter((item) => item.effectiveLateMinutes === 0).length,
        actualLateDays: attendance.filter((item) => item.actualLateMinutes > 0).length,
        effectiveLateDays: attendance.filter((item) => item.effectiveLateMinutes > 0).length,
        lateArrivalPermissionDays: attendance.filter((item) => item.lateArrivalStatus === 'PENDING' || item.lateArrivalStatus === 'APPROVED').length,
        totalWorkedMinutes: attendance.reduce((sum, item) => sum + (item.workedMinutes ?? 0), 0),
        totalWorkDeficitMinutes: attendance.reduce((sum, item) => sum + (item.workDeficitMinutes ?? 0), 0),
      };
      const allActivity: DashboardActivity[] = [...attendance, ...source.leaves, ...source.earlyDepartures]
        .filter((item) => input.type === 'ALL' || item.type === input.type)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
      const totalItems = allActivity.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / input.pageSize));
      const start = (input.page - 1) * input.pageSize;
      return StaffDashboardResponseSchema.parse({
        serverNow: serverNow.toISOString(), role: staff.role, month,
        todayAttendance, securityDuty, requestQuotas, metrics,
        punctualityTrend: attendance
          .map((item) => ({ workDate: item.workDate, arrivalOffsetMinutes: item.arrivalOffsetMinutes,
            actualLateMinutes: item.actualLateMinutes, effectiveLateMinutes: item.effectiveLateMinutes,
            lateArrivalStatus: item.lateArrivalStatus }))
          .sort((left, right) => left.workDate.localeCompare(right.workDate)),
        activity: { data: allActivity.slice(start, start + input.pageSize),
          pagination: { page: input.page, pageSize: input.pageSize, totalItems, totalPages } },
        latestEarlyDeparture: source.latestEarlyDeparture,
        streak: staff.role === 'USER' ? streak(source.streakDays) : null,
      });
    },
  };
}

function currentUser(request: Request): AuthUser {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user;
}

export function registerStaffDashboardRoutes(app: Express, authService: AuthService, service: StaffDashboardService): void {
  app.get('/api/dashboard', createSessionGuard(authService), requireRole('USER', 'SECURITY_GUARD'), async (request, response, next) => {
    try {
      const parsed = StaffDashboardQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Filter dashboard tidak valid', parsed.error.flatten());
      response.status(200).json(await service.get(currentUser(request), parsed.data));
    } catch (error) { next(error); }
  });
}
