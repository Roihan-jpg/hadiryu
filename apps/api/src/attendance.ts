import {
  AttendanceHistoryResponseSchema,
  AttendanceRecordSchema,
  CompletedAttendanceRecordSchema,
  IncompleteAttendanceRecordSchema,
  ListAttendanceHistoryQuerySchema,
  LocationInputSchema,
  TodayAttendanceResponseSchema,
  type AttendanceHistoryResponse,
  type AttendanceRecord,
  type AuthUser,
  type CalendarException,
  type CheckInRecord,
  type CompletedAttendanceRecord,
  type GeofenceRule,
  type GeofenceCoordinate,
  type ListAttendanceHistoryQuery,
  type LocationInput,
  type ScheduleRule,
  type ScheduleType,
  type SecurityScheduleSettingsResponse,
  type TodayAttendanceResponse,
  type TodaySchedule,
} from '@absensi/contracts';
import type { Express, Request } from 'express';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';
import { resolveCalendarDay } from './calendar-payroll.js';
import {
  addLocalDays,
  buildSecurityShiftBoundaries,
  resolveSecurityAssignment,
  type ShiftBoundaries,
} from './security-duty.js';
import { adjustedAttendanceMetrics, type AttendanceAdjustmentContext } from './attendance-adjustments.js';

const EARTH_RADIUS_METERS = 6_371_008.8;
const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

export interface SaveCheckInInput {
  teacherId: string;
  workDate: string;
  checkInAt: string;
  location: LocationInput;
  distanceMeters: number;
  boundaryClearanceMeters: number | null;
  schedule: ScheduleRule;
  boundaries: ShiftBoundaries;
  arrivalLateMinutes: number;
}

export interface SaveCheckoutInput {
  attendanceId: string;
  teacherId: string;
  workDate: string;
  checkOutAt: string;
  location: LocationInput;
  distanceMeters: number;
  boundaryClearanceMeters: number | null;
  workedMinutes: number;
  workDeficitMinutes: number;
}

export type PersistedAttendanceRecord =
  | CheckInRecord
  | CompletedAttendanceRecord;

type StaffIdentity = Pick<AuthUser, 'id' | 'role'>;

export interface AttendanceRepository {
  findAttendance(
    teacherId: string,
    workDate: string,
  ): Promise<PersistedAttendanceRecord | null>;
  findCalendarException(workDate: string): Promise<CalendarException | null>;
  findSchedule(
    scheduleType: ScheduleType,
    workDate: string,
  ): Promise<ScheduleRule | null>;
  findSecuritySchedules?(workDate: string): Promise<SecurityScheduleSettingsResponse>;
  findGeofence(workDate: string): Promise<GeofenceRule | null>;
  hasApprovedLeave(teacherId: string, workDate: string): Promise<boolean>;
  findAttendancePermissions?(
    teacherId: string,
    records: Array<{ attendanceId: string; workDate: string }>,
  ): Promise<Map<string, AttendanceAdjustmentContext>>;
  saveCheckIn(input: SaveCheckInInput): Promise<PersistedAttendanceRecord>;
  saveCheckout(input: SaveCheckoutInput): Promise<CompletedAttendanceRecord>;
  listAttendanceHistory(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<{ records: PersistedAttendanceRecord[]; totalItems: number }>;
}

export interface AttendanceService {
  getToday(staff: string | StaffIdentity): Promise<TodayAttendanceResponse>;
  checkIn(staff: string | StaffIdentity, location: LocationInput): Promise<AttendanceRecord>;
  checkout(
    staff: string | StaffIdentity,
    location: LocationInput,
  ): Promise<CompletedAttendanceRecord>;
  history(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<AttendanceHistoryResponse>;
}

function staffIdentity(value: string | StaffIdentity): StaffIdentity {
  return typeof value === 'string' ? { id: value, role: 'USER' } : value;
}

export interface JakartaDateTime {
  workDate: string;
  minuteOfDay: number;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  if (latitudeA === latitudeB && longitudeA === longitudeB) return 0;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const latitudeARadians = radians(latitudeA);
  const latitudeBRadians = radians(latitudeB);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeARadians) *
      Math.cos(latitudeBRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function jakartaDateTime(value: Date): JakartaDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const hour = Number(part('hour'));
  const minute = Number(part('minute'));
  return {
    workDate: `${part('year')}-${part('month')}-${part('day')}`,
    minuteOfDay: hour * 60 + minute,
  };
}

export function timeMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function todaySchedule(schedule: ScheduleRule): TodaySchedule {
  return {
    scheduleType: schedule.scheduleType,
    checkInOpen: schedule.checkInOpen,
    workStart: schedule.workStart,
    checkInClose: schedule.checkInClose,
    checkoutOpen: schedule.checkoutOpen,
    workEnd: schedule.workEnd,
    checkoutClose: schedule.checkoutClose,
    targetMinutes: schedule.targetMinutes,
  };
}

function todayScheduleSnapshot(
  attendance: PersistedAttendanceRecord,
): TodaySchedule | null {
  if (
    !attendance.scheduleType ||
    !attendance.checkInOpenAt ||
    !attendance.workStartAt ||
    !attendance.checkInCloseAt ||
    !attendance.checkoutOpenAt ||
    !attendance.workEndAt ||
    !attendance.checkoutCloseAt
  ) return null;
  const localTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: JAKARTA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
  return {
    scheduleType: attendance.scheduleType,
    checkInOpen: localTime(attendance.checkInOpenAt),
    workStart: localTime(attendance.workStartAt),
    checkInClose: localTime(attendance.checkInCloseAt),
    checkoutOpen: localTime(attendance.checkoutOpenAt),
    workEnd: localTime(attendance.workEndAt),
    checkoutClose: localTime(attendance.checkoutCloseAt),
    targetMinutes: attendance.targetMinutes,
  };
}

async function resolveDay(
  repository: AttendanceRepository,
  workDate: string,
): Promise<{ schedule: ScheduleRule | null; isWorkingDay: boolean }> {
  const exception = await repository.findCalendarException(workDate);
  const day = resolveCalendarDay(workDate, exception);
  if (!day.isWorkingDay || !day.scheduleType) {
    return { schedule: null, isWorkingDay: false };
  }
  return {
    schedule: await repository.findSchedule(day.scheduleType, workDate),
    isWorkingDay: true,
  };
}

async function resolveStaffDay(
  repository: AttendanceRepository,
  staff: StaffIdentity,
  workDate: string,
): Promise<{ schedule: ScheduleRule | null; isWorkingDay: boolean; rotationDay?: 1 | 2 | 3; assignment?: 'DAY' | 'NIGHT' | 'OFF' | 'UNASSIGNED' }> {
  if (staff.role !== 'SECURITY_GUARD') return resolveDay(repository, workDate);
  const settings = await repository.findSecuritySchedules?.(workDate);
  if (!settings?.roster || !settings.dayShift || !settings.nightShift) {
    return { schedule: null, isWorkingDay: true };
  }
  const assignment = resolveSecurityAssignment(settings.roster, workDate, staff.id);
  if (assignment.status === 'OFF' || assignment.status === 'UNASSIGNED') {
    return { schedule: null, isWorkingDay: false, rotationDay: assignment.rotationDay, assignment: assignment.status };
  }
  return {
    schedule: assignment.status === 'DAY' ? settings.dayShift : settings.nightShift,
    isWorkingDay: true,
    rotationDay: assignment.rotationDay,
    assignment: assignment.status,
  };
}

function scheduleBoundaries(workDate: string, schedule: ScheduleRule): ShiftBoundaries {
  if (schedule.scheduleType === 'SECURITY_DAY' || schedule.scheduleType === 'SECURITY_NIGHT') {
    return buildSecurityShiftBoundaries(workDate, schedule, schedule.scheduleType);
  }
  const instant = (time: string) => new Date(`${workDate}T${time}:00+07:00`).toISOString();
  return {
    checkInOpenAt: instant(schedule.checkInOpen),
    workStartAt: instant(schedule.workStart),
    checkInCloseAt: instant(schedule.checkInClose),
    checkoutOpenAt: instant(schedule.checkoutOpen),
    workEndAt: instant(schedule.workEnd),
    checkoutCloseAt: instant(schedule.checkoutClose),
  };
}

function withLiveUserSchedule<T extends PersistedAttendanceRecord>(
  attendance: T,
  schedule: ScheduleRule,
): T {
  const boundaries = scheduleBoundaries(attendance.workDate, schedule);
  return {
    ...attendance,
    workStart: schedule.workStart,
    workEnd: schedule.workEnd,
    checkoutClose: schedule.checkoutClose,
    targetMinutes: schedule.targetMinutes,
    scheduleType: schedule.scheduleType,
    checkInOpenAt: boundaries.checkInOpenAt,
    workStartAt: boundaries.workStartAt,
    checkInCloseAt: boundaries.checkInCloseAt,
    checkoutOpenAt: boundaries.checkoutOpenAt,
    workEndAt: boundaries.workEndAt,
    checkoutCloseAt: boundaries.checkoutCloseAt,
  } as T;
}

function roundedMeters(value: number): number {
  return Math.round(value * 100) / 100;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

function projectPoint(
  point: GeofenceCoordinate,
  reference: GeofenceCoordinate,
): ProjectedPoint {
  return {
    x: EARTH_RADIUS_METERS * radians(point.longitude - reference.longitude) *
      Math.cos(radians(reference.latitude)),
    y: EARTH_RADIUS_METERS * radians(point.latitude - reference.latitude),
  };
}

function polygonReference(vertices: readonly GeofenceCoordinate[]): GeofenceCoordinate {
  return {
    latitude: vertices.reduce((sum, vertex) => sum + vertex.latitude, 0) / vertices.length,
    longitude: vertices.reduce((sum, vertex) => sum + vertex.longitude, 0) / vertices.length,
  };
}

function pointInsidePolygon(
  point: ProjectedPoint,
  vertices: readonly ProjectedPoint[],
): boolean {
  let inside = false;
  for (let current = 0, previous = vertices.length - 1; current < vertices.length; previous = current++) {
    const a = vertices[current]!;
    const b = vertices[previous]!;
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: ProjectedPoint,
  start: ProjectedPoint,
  end: ProjectedPoint,
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const position = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + position * deltaX),
    point.y - (start.y + position * deltaY),
  );
}

function polygonBoundaryClearance(
  location: LocationInput,
  vertices: readonly GeofenceCoordinate[],
): { inside: boolean; clearanceMeters: number; distanceToReferenceMeters: number } {
  const reference = polygonReference(vertices);
  const point = projectPoint(location, reference);
  const projectedVertices = vertices.map((vertex) => projectPoint(vertex, reference));
  let clearanceMeters = Number.POSITIVE_INFINITY;
  for (let index = 0; index < projectedVertices.length; index += 1) {
    clearanceMeters = Math.min(clearanceMeters, distanceToSegment(
      point,
      projectedVertices[index]!,
      projectedVertices[(index + 1) % projectedVertices.length]!,
    ));
  }
  return {
    inside: pointInsidePolygon(point, projectedVertices),
    clearanceMeters,
    distanceToReferenceMeters: haversineDistanceMeters(
      reference.latitude,
      reference.longitude,
      location.latitude,
      location.longitude,
    ),
  };
}

export interface ValidatedGeofenceLocation {
  distanceMeters: number;
  boundaryClearanceMeters: number | null;
}

export function validatedLocation(
  location: LocationInput,
  geofence: GeofenceRule,
): ValidatedGeofenceLocation {
  if (location.accuracyMeters > geofence.maxAccuracyMeters) {
    throw new AppError(
      422,
      'LOCATION_INACCURATE',
      `Akurasi lokasi ${Math.round(location.accuracyMeters)} meter belum memenuhi batas ${geofence.maxAccuracyMeters} meter. Berpindah ke halaman terbuka lalu coba lagi`,
      {
        accuracyMeters: roundedMeters(location.accuracyMeters),
        maxAccuracyMeters: geofence.maxAccuracyMeters,
      },
    );
  }
  if (geofence.shape === 'POLYGON') {
    const result = polygonBoundaryClearance(location, geofence.vertices);
    if (!result.inside) {
      throw new AppError(422, 'OUTSIDE_GEOFENCE', 'Anda berada di luar zona absensi sekolah', {
        distanceToBoundaryMeters: roundedMeters(result.clearanceMeters),
      });
    }
    if (result.clearanceMeters <= 0.01 || result.clearanceMeters < location.accuracyMeters) {
      throw new AppError(
        422,
        'LOCATION_UNCERTAIN_NEAR_BOUNDARY',
        'Lokasi terdeteksi terlalu dekat batas zona. Bergerak ke tengah halaman lalu coba lagi',
        {
          accuracyMeters: roundedMeters(location.accuracyMeters),
          boundaryClearanceMeters: roundedMeters(result.clearanceMeters),
        },
      );
    }
    return {
      distanceMeters: roundedMeters(result.distanceToReferenceMeters),
      boundaryClearanceMeters: roundedMeters(result.clearanceMeters),
    };
  }
  const distanceMeters = haversineDistanceMeters(
    geofence.latitude,
    geofence.longitude,
    location.latitude,
    location.longitude,
  );
  if (distanceMeters > geofence.radiusMeters) {
    throw new AppError(422, 'OUTSIDE_GEOFENCE', 'Anda berada di luar radius sekolah', {
      distanceMeters: roundedMeters(distanceMeters),
      radiusMeters: geofence.radiusMeters,
    });
  }
  return { distanceMeters: roundedMeters(distanceMeters), boundaryClearanceMeters: null };
}

export function validatedDistance(
  location: LocationInput,
  geofence: GeofenceRule,
): number {
  return validatedLocation(location, geofence).distanceMeters;
}

function derivedAttendance(
  attendance: PersistedAttendanceRecord,
  serverNow: Date,
): AttendanceRecord {
  if (attendance.status === 'COMPLETED') return attendance;
  const current = jakartaDateTime(serverNow);
  const cutoffPassed =
    attendance.checkoutCloseAt
      ? serverNow.getTime() > new Date(attendance.checkoutCloseAt).getTime()
      : attendance.workDate < current.workDate ||
        (attendance.workDate === current.workDate && current.minuteOfDay > timeMinutes(attendance.checkoutClose));
  if (!cutoffPassed) return attendance;
  return IncompleteAttendanceRecordSchema.parse({
    ...attendance,
    checkOutAt: null,
    workedMinutes: Math.max(0, attendance.targetMinutes - 60),
    workDeficitMinutes: Math.min(60, attendance.targetMinutes),
    status: 'INCOMPLETE',
  });
}

function activeAttendance(
  attendance: PersistedAttendanceRecord | null,
  serverNow: Date,
): PersistedAttendanceRecord | null {
  return attendance?.status === 'CHECKED_IN' &&
    derivedAttendance(attendance, serverNow).status === 'CHECKED_IN'
    ? attendance
    : null;
}

function applyAttendancePermissions(
  attendance: AttendanceRecord,
  context: AttendanceAdjustmentContext,
): AttendanceRecord {
  const metrics = {
    workDate: attendance.workDate,
    checkInAt: attendance.checkInAt,
    checkOutAt: 'checkOutAt' in attendance ? attendance.checkOutAt : null,
    workStart: attendance.workStart,
    workEnd: attendance.workEnd,
    targetMinutes: attendance.targetMinutes,
    workedMinutes: 'workedMinutes' in attendance ? attendance.workedMinutes : null,
    workDeficitMinutes: 'workDeficitMinutes' in attendance ? attendance.workDeficitMinutes : null,
    arrivalLateMinutes: attendance.arrivalLateMinutes,
    status: attendance.status,
  } as const;
  const adjusted = adjustedAttendanceMetrics(
    'workStartAt' in attendance && attendance.workStartAt
      ? 'workEndAt' in attendance && attendance.workEndAt
        ? { ...metrics, workStartAt: attendance.workStartAt, workEndAt: attendance.workEndAt }
        : { ...metrics, workStartAt: attendance.workStartAt }
      : 'workEndAt' in attendance && attendance.workEndAt
        ? { ...metrics, workEndAt: attendance.workEndAt }
        : metrics,
    context,
  );
  const result = { ...attendance, arrivalLateMinutes: adjusted.arrivalLateMinutes };
  if ('workedMinutes' in attendance) {
    return {
      ...result,
      workedMinutes: adjusted.workedMinutes,
      workDeficitMinutes: adjusted.workDeficitMinutes,
    } as AttendanceRecord;
  }
  return result as AttendanceRecord;
}

export function createAttendanceService(
  repository: AttendanceRepository,
  now: () => Date = () => new Date(),
): AttendanceService {
  return {
    async getToday(staffValue) {
      const staff = staffIdentity(staffValue);
      const teacherId = staff.id;
      const serverNow = now();
      const { workDate } = jakartaDateTime(serverNow);
      let existing = await repository.findAttendance(teacherId, workDate);
      if (staff.role === 'SECURITY_GUARD') {
        const previous = await repository.findAttendance(teacherId, addLocalDays(workDate, -1));
        existing = activeAttendance(previous, serverNow) ?? existing;
      }
      if (existing) {
        const liveSchedule = staff.role === 'USER'
          ? (await resolveStaffDay(repository, staff, existing.workDate)).schedule
          : null;
        const attendance = derivedAttendance(
          liveSchedule ? withLiveUserSchedule(existing, liveSchedule) : existing,
          serverNow,
        );
        const permissionContext = await repository.findAttendancePermissions?.(
          teacherId,
          [{ attendanceId: attendance.id, workDate: attendance.workDate }],
        );
        const effectiveAttendance = applyAttendancePermissions(
          attendance,
          permissionContext?.get(attendance.workDate) ?? {},
        );
        const snapshotSchedule = todayScheduleSnapshot(existing);
        const resolvedSchedule = liveSchedule ?? (snapshotSchedule
          ? null
          : (await resolveStaffDay(repository, staff, existing.workDate)).schedule);
        const geofence = await repository.findGeofence(existing.workDate);
        return TodayAttendanceResponseSchema.parse({
          serverNow: serverNow.toISOString(),
          workDate: existing.workDate,
          state: effectiveAttendance.status,
          schedule: resolvedSchedule
            ? todaySchedule(resolvedSchedule)
            : snapshotSchedule,
          attendance: effectiveAttendance,
          locationRequirement: geofence
            ? { maxAccuracyMeters: geofence.maxAccuracyMeters }
            : null,
        });
      }

      const day = await resolveStaffDay(repository, staff, workDate);
      if (!day.isWorkingDay) {
        return TodayAttendanceResponseSchema.parse({
          serverNow: serverNow.toISOString(),
          workDate,
          state: 'NON_WORKING_DAY',
          schedule: null,
          attendance: null,
        });
      }
      const geofence = await repository.findGeofence(workDate);
      return TodayAttendanceResponseSchema.parse({
        serverNow: serverNow.toISOString(),
        workDate,
        state:
          day.schedule && geofence
            ? 'READY_TO_CHECK_IN'
            : 'CONFIGURATION_ERROR',
        schedule: day.schedule ? todaySchedule(day.schedule) : null,
        attendance: null,
        locationRequirement: geofence
          ? { maxAccuracyMeters: geofence.maxAccuracyMeters }
          : null,
      });
    },

    async checkIn(staffValue, location) {
      const staff = staffIdentity(staffValue);
      const teacherId = staff.id;
      const serverNow = now();
      const { workDate, minuteOfDay } = jakartaDateTime(serverNow);
      const existing = await repository.findAttendance(teacherId, workDate);
      if (existing) {
        const liveSchedule = staff.role === 'USER'
          ? (await resolveStaffDay(repository, staff, existing.workDate)).schedule
          : null;
        const effectiveExisting = liveSchedule
          ? withLiveUserSchedule(existing, liveSchedule)
          : existing;
        const permissionContext = await repository.findAttendancePermissions?.(
          teacherId,
          [{ attendanceId: existing.id, workDate: existing.workDate }],
        );
        return AttendanceRecordSchema.parse(
          applyAttendancePermissions(effectiveExisting, permissionContext?.get(existing.workDate) ?? {}),
        );
      }

      const day = await resolveStaffDay(repository, staff, workDate);
      if (!day.isWorkingDay) {
        throw new AppError(422, 'NOT_A_WORKING_DAY', 'Hari ini bukan hari kerja');
      }
      if (!day.schedule) {
        throw new AppError(
          422,
          'SCHEDULE_NOT_CONFIGURED',
          'Jadwal untuk hari ini belum dikonfigurasi',
        );
      }
      const geofence = await repository.findGeofence(workDate);
      if (!geofence) {
        throw new AppError(
          422,
          'GEOFENCE_NOT_CONFIGURED',
          'Lokasi sekolah untuk hari ini belum dikonfigurasi',
        );
      }
      if (
        minuteOfDay < timeMinutes(day.schedule.checkInOpen) ||
        minuteOfDay > timeMinutes(day.schedule.checkInClose)
      ) {
        throw new AppError(
          422,
          'OUTSIDE_ATTENDANCE_WINDOW',
          'Check-in hanya dapat dilakukan pada jadwal yang ditentukan',
          {
            checkInOpen: day.schedule.checkInOpen,
            checkInClose: day.schedule.checkInClose,
          },
        );
      }
      if (await repository.hasApprovedLeave(teacherId, workDate)) {
        throw new AppError(
          409,
          'ALREADY_HAS_APPROVED_LEAVE',
          'Check-in tidak dapat dilakukan karena izin sudah disetujui',
        );
      }
      const { distanceMeters, boundaryClearanceMeters } = validatedLocation(location, geofence);
      const boundaries = scheduleBoundaries(workDate, day.schedule);

      const saved = await repository.saveCheckIn({
          teacherId,
          workDate,
          checkInAt: serverNow.toISOString(),
          location,
          distanceMeters,
          boundaryClearanceMeters,
          schedule: day.schedule,
          boundaries,
          arrivalLateMinutes: Math.max(
            0,
            Math.floor((serverNow.getTime() - new Date(boundaries.workStartAt).getTime()) / 60_000),
          ),
        });
      const permissionContext = await repository.findAttendancePermissions?.(
        teacherId,
        [{ attendanceId: saved.id, workDate: saved.workDate }],
      );
      return AttendanceRecordSchema.parse(
        applyAttendancePermissions(saved, permissionContext?.get(saved.workDate) ?? {}),
      );
    },

    async checkout(staffValue, location) {
      const staff = staffIdentity(staffValue);
      const teacherId = staff.id;
      const serverNow = now();
      const { workDate } = jakartaDateTime(serverNow);
      let existing = await repository.findAttendance(teacherId, workDate);
      if (staff.role === 'SECURITY_GUARD') {
        const previous = await repository.findAttendance(teacherId, addLocalDays(workDate, -1));
        existing = activeAttendance(previous, serverNow) ?? existing ??
          (previous?.status === 'COMPLETED' ? previous : null);
      }
      if (!existing) {
        throw new AppError(
          409,
          'CHECK_IN_REQUIRED',
          'Checkout hanya dapat dilakukan setelah check-in',
        );
      }
      const liveSchedule = staff.role === 'USER'
        ? (await resolveStaffDay(repository, staff, existing.workDate)).schedule
        : null;
      if (staff.role === 'USER' && !liveSchedule) {
        throw new AppError(
          422,
          'SCHEDULE_NOT_CONFIGURED',
          'Jadwal untuk hari ini belum dikonfigurasi',
        );
      }
      const effectiveExisting = liveSchedule
        ? withLiveUserSchedule(existing, liveSchedule)
        : existing;
      if (effectiveExisting.status === 'COMPLETED') {
        const permissionContext = await repository.findAttendancePermissions?.(
          teacherId,
          [{ attendanceId: effectiveExisting.id, workDate: effectiveExisting.workDate }],
        );
        return CompletedAttendanceRecordSchema.parse(
          applyAttendancePermissions(effectiveExisting, permissionContext?.get(effectiveExisting.workDate) ?? {}),
        );
      }

      let fallbackBoundaries: ShiftBoundaries | null = null;
      if (!effectiveExisting.checkoutOpenAt || !effectiveExisting.checkoutCloseAt) {
        const schedule = (await resolveStaffDay(repository, staff, effectiveExisting.workDate)).schedule;
        if (!schedule) {
          throw new AppError(
            422,
            'SCHEDULE_NOT_CONFIGURED',
            'Jadwal untuk hari ini belum dikonfigurasi',
          );
        }
        fallbackBoundaries = scheduleBoundaries(effectiveExisting.workDate, schedule);
      }
      const checkoutOpenAt = effectiveExisting.checkoutOpenAt ?? fallbackBoundaries!.checkoutOpenAt;
      const checkoutCloseAt = effectiveExisting.checkoutCloseAt ?? fallbackBoundaries!.checkoutCloseAt;
      if (serverNow.getTime() < new Date(checkoutOpenAt).getTime() || serverNow.getTime() > new Date(checkoutCloseAt).getTime()) {
        throw new AppError(
          422,
          'OUTSIDE_ATTENDANCE_WINDOW',
          'Checkout hanya dapat dilakukan pada jadwal yang ditentukan',
          {
            checkoutOpen: checkoutOpenAt,
            checkoutClose: effectiveExisting.checkoutClose,
          },
        );
      }
      const geofence = await repository.findGeofence(effectiveExisting.workDate);
      if (!geofence) {
        throw new AppError(
          422,
          'GEOFENCE_NOT_CONFIGURED',
          'Lokasi sekolah untuk hari ini belum dikonfigurasi',
        );
      }
      const { distanceMeters, boundaryClearanceMeters } = validatedLocation(location, geofence);
      const workedMinutes = Math.max(
        0,
        Math.floor(
          (serverNow.getTime() - new Date(effectiveExisting.checkInAt).getTime()) / 60_000,
        ),
      );
      const saved = await repository.saveCheckout({
          attendanceId: effectiveExisting.id,
          teacherId,
          workDate: effectiveExisting.workDate,
          checkOutAt: serverNow.toISOString(),
          location,
          distanceMeters,
          boundaryClearanceMeters,
          workedMinutes,
          workDeficitMinutes: Math.max(
            0,
            effectiveExisting.targetMinutes - workedMinutes,
          ),
        });
      const permissionContext = await repository.findAttendancePermissions?.(
        teacherId,
        [{ attendanceId: saved.id, workDate: saved.workDate }],
      );
      return CompletedAttendanceRecordSchema.parse(
        applyAttendancePermissions(
          liveSchedule ? withLiveUserSchedule(saved, liveSchedule) : saved,
          permissionContext?.get(saved.workDate) ?? {},
        ),
      );
    },

    async history(teacherId, input) {
      const query = ListAttendanceHistoryQuerySchema.parse(input);
      const result = await repository.listAttendanceHistory(teacherId, query);
      const serverNow = now();
      const permissionContext = await repository.findAttendancePermissions?.(
        teacherId,
        result.records.map((record) => ({ attendanceId: record.id, workDate: record.workDate })),
      );
      const totalItems = result.totalItems;
      return AttendanceHistoryResponseSchema.parse({
        data: result.records.map((record) => {
          const derived = derivedAttendance(record, serverNow);
          return AttendanceRecordSchema.parse(
            applyAttendancePermissions(derived, permissionContext?.get(record.workDate) ?? {}),
          );
        }),
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / query.pageSize),
        },
      });
    },
  };
}

function teacherId(request: Request): string {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) {
    throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  }
  return user.id;
}

function staffUser(request: Request): AuthUser {
  const user = request.res?.locals['authUser'] as AuthUser | undefined;
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu');
  return user;
}

export function registerAttendanceRoutes(
  app: Express,
  authService: AuthService,
  attendanceService: AttendanceService,
): void {
  const teacherGuards = [createSessionGuard(authService), requireRole('USER', 'SECURITY_GUARD')];

  app.get(
    '/api/attendance/today',
    ...teacherGuards,
    async (request, response, next) => {
      try {
        response
          .status(200)
          .json(await attendanceService.getToday(staffUser(request)));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/attendance/check-in',
    ...teacherGuards,
    async (request, response, next) => {
      try {
        const parsed = LocationInputSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Data lokasi tidak valid',
            parsed.error.flatten(),
          );
        }
        response
          .status(200)
          .json(await attendanceService.checkIn(staffUser(request), parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/attendance/checkout',
    ...teacherGuards,
    async (request, response, next) => {
      try {
        const parsed = LocationInputSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Data lokasi tidak valid',
            parsed.error.flatten(),
          );
        }
        response
          .status(200)
          .json(await attendanceService.checkout(staffUser(request), parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/api/attendance/history',
    ...teacherGuards,
    async (request, response, next) => {
      try {
        const parsed = ListAttendanceHistoryQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Parameter riwayat absensi tidak valid',
            parsed.error.flatten(),
          );
        }
        response
          .status(200)
          .json(await attendanceService.history(teacherId(request), parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );
}
