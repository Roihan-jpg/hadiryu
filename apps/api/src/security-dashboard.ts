import {
  SecurityGuardDashboardResponseSchema,
  type AuthUser,
  type SecurityDuty,
  type SecurityGuardDashboardResponse,
} from '@absensi/contracts';
import type { Express, Request } from 'express';

import { AppError, createSessionGuard, requireRole, type AuthService } from './auth.js';
import {
  jakartaDateTime,
  type AttendanceRepository,
  type PersistedAttendanceRecord,
} from './attendance.js';
import {
  addLocalDays,
  buildSecurityShiftBoundaries,
  resolveSecurityAssignment,
} from './security-duty.js';

export interface SecurityDashboardService {
  getDashboard(guardId: string): Promise<SecurityGuardDashboardResponse>;
}

async function resolveDuty(
  repository: AttendanceRepository,
  guardId: string,
  workDate: string,
): Promise<SecurityDuty> {
  const settings = await repository.findSecuritySchedules?.(workDate);
  if (!settings?.roster || !settings.dayShift || !settings.nightShift) {
    return { workDate, rotationDay: null, status: 'CONFIGURATION_ERROR', scheduleType: null, targetMinutes: null, boundaries: null };
  }
  const assignment = resolveSecurityAssignment(settings.roster, workDate, guardId);
  if (assignment.status === 'OFF' || assignment.status === 'UNASSIGNED') {
    return { workDate, rotationDay: assignment.rotationDay, status: assignment.status, scheduleType: null, targetMinutes: null, boundaries: null };
  }
  const schedule = assignment.status === 'DAY' ? settings.dayShift : settings.nightShift;
  return {
    workDate,
    rotationDay: assignment.rotationDay,
    status: assignment.status,
    scheduleType: schedule.scheduleType,
    targetMinutes: schedule.targetMinutes,
    boundaries: buildSecurityShiftBoundaries(workDate, schedule, schedule.scheduleType as 'SECURITY_DAY' | 'SECURITY_NIGHT'),
  };
}

function dutyFromAttendanceSnapshot(
  attendance: PersistedAttendanceRecord,
  resolvedDuty: SecurityDuty,
): SecurityDuty {
  if (
    (attendance.scheduleType !== 'SECURITY_DAY' && attendance.scheduleType !== 'SECURITY_NIGHT') ||
    !attendance.checkInOpenAt ||
    !attendance.workStartAt ||
    !attendance.checkInCloseAt ||
    !attendance.checkoutOpenAt ||
    !attendance.workEndAt ||
    !attendance.checkoutCloseAt
  ) return resolvedDuty;
  return {
    workDate: attendance.workDate,
    rotationDay: resolvedDuty.rotationDay,
    status: attendance.scheduleType === 'SECURITY_DAY' ? 'DAY' : 'NIGHT',
    scheduleType: attendance.scheduleType,
    targetMinutes: attendance.targetMinutes,
    boundaries: {
      checkInOpenAt: attendance.checkInOpenAt,
      workStartAt: attendance.workStartAt,
      checkInCloseAt: attendance.checkInCloseAt,
      checkoutOpenAt: attendance.checkoutOpenAt,
      workEndAt: attendance.workEndAt,
      checkoutCloseAt: attendance.checkoutCloseAt,
    },
  };
}

export function createSecurityDashboardService(
  repository: AttendanceRepository,
  now: () => Date = () => new Date(),
): SecurityDashboardService {
  return {
    async getDashboard(guardId) {
      const serverNow = now();
      const { workDate: calendarDate } = jakartaDateTime(serverNow);
      const currentDuty = await resolveDuty(repository, guardId, calendarDate);
      const previousDate = addLocalDays(calendarDate, -1);
      const [todayAttendance, previousAttendance, history, geofence] = await Promise.all([
        repository.findAttendance(guardId, calendarDate),
        repository.findAttendance(guardId, previousDate),
        repository.listAttendanceHistory(guardId, { page: 1, pageSize: 1 }),
        repository.findGeofence(calendarDate),
      ]);
      const isActive = (attendance: typeof todayAttendance) => attendance?.status === 'CHECKED_IN' &&
        (!attendance.checkoutCloseAt || serverNow.getTime() <= new Date(attendance.checkoutCloseAt).getTime());
      const activeAttendance = isActive(todayAttendance)
        ? todayAttendance
        : isActive(previousAttendance)
          ? previousAttendance
          : null;
      let activeDuty: SecurityDuty | null = null;
      if (activeAttendance) {
        const resolvedDuty = await resolveDuty(repository, guardId, activeAttendance.workDate);
        activeDuty = dutyFromAttendanceSnapshot(activeAttendance, resolvedDuty);
      } else if (currentDuty.status === 'DAY' || currentDuty.status === 'NIGHT') {
        activeDuty = currentDuty;
      }
      let nextWorkingDuty: SecurityDuty | null = null;
      for (let offset = 1; offset <= 6 && !nextWorkingDuty; offset += 1) {
        const candidate = await resolveDuty(repository, guardId, addLocalDays(calendarDate, offset));
        if (candidate.status === 'DAY' || candidate.status === 'NIGHT') nextWorkingDuty = candidate;
      }
      return SecurityGuardDashboardResponseSchema.parse({
        serverNow: serverNow.toISOString(),
        calendarDate,
        currentDuty,
        activeDuty,
        activeAttendance,
        latestAttendance: history.records[0] ?? null,
        nextWorkingDuty,
        locationRequirement: geofence ? { maxAccuracyMeters: geofence.maxAccuracyMeters } : null,
      });
    },
  };
}

function guardId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user.id;
}

export function registerSecurityDashboardRoutes(
  app: Express,
  authService: AuthService,
  service: SecurityDashboardService,
): void {
  app.get(
    '/api/security-guard/dashboard',
    createSessionGuard(authService),
    requireRole('SECURITY_GUARD'),
    async (request, response, next) => {
      try {
        response.status(200).json(await service.getDashboard(guardId(request)));
      } catch (error) {
        next(error);
      }
    },
  );
}
