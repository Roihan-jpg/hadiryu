import {
  CheckInRecordSchema,
  LocationInputSchema,
  TodayAttendanceResponseSchema,
  type AuthUser,
  type CalendarException,
  type CheckInRecord,
  type GeofenceRule,
  type LocationInput,
  type ScheduleRule,
  type ScheduleType,
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

const EARTH_RADIUS_METERS = 6_371_008.8;
const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

export interface SaveCheckInInput {
  teacherId: string;
  workDate: string;
  checkInAt: string;
  location: LocationInput;
  distanceMeters: number;
  schedule: ScheduleRule;
  arrivalLateMinutes: number;
}

export interface AttendanceRepository {
  findAttendance(teacherId: string, workDate: string): Promise<CheckInRecord | null>;
  findCalendarException(workDate: string): Promise<CalendarException | null>;
  findSchedule(
    scheduleType: ScheduleType,
    workDate: string,
  ): Promise<ScheduleRule | null>;
  findGeofence(workDate: string): Promise<GeofenceRule | null>;
  hasApprovedLeave(teacherId: string, workDate: string): Promise<boolean>;
  saveCheckIn(input: SaveCheckInInput): Promise<CheckInRecord>;
}

export interface AttendanceService {
  getToday(teacherId: string): Promise<TodayAttendanceResponse>;
  checkIn(teacherId: string, location: LocationInput): Promise<CheckInRecord>;
}

interface JakartaDateTime {
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

function jakartaDateTime(value: Date): JakartaDateTime {
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

function timeMinutes(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function todaySchedule(schedule: ScheduleRule): TodaySchedule {
  return {
    scheduleType: schedule.scheduleType,
    checkInOpen: schedule.checkInOpen,
    workStart: schedule.workStart,
    checkInClose: schedule.checkInClose,
    workEnd: schedule.workEnd,
    targetMinutes: schedule.targetMinutes,
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

function roundedMeters(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createAttendanceService(
  repository: AttendanceRepository,
  now: () => Date = () => new Date(),
): AttendanceService {
  return {
    async getToday(teacherId) {
      const serverNow = now();
      const { workDate } = jakartaDateTime(serverNow);
      const existing = await repository.findAttendance(teacherId, workDate);
      if (existing) {
        return TodayAttendanceResponseSchema.parse({
          serverNow: serverNow.toISOString(),
          workDate,
          state: 'CHECKED_IN',
          schedule: null,
          attendance: existing,
        });
      }

      const day = await resolveDay(repository, workDate);
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
      });
    },

    async checkIn(teacherId, location) {
      const serverNow = now();
      const { workDate, minuteOfDay } = jakartaDateTime(serverNow);
      const existing = await repository.findAttendance(teacherId, workDate);
      if (existing) return existing;

      const day = await resolveDay(repository, workDate);
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
      if (location.accuracyMeters > geofence.maxAccuracyMeters) {
        throw new AppError(
          422,
          'LOCATION_INACCURATE',
          'Akurasi lokasi belum memadai. Aktifkan lokasi presisi lalu coba lagi',
          { maxAccuracyMeters: geofence.maxAccuracyMeters },
        );
      }
      const distanceMeters = haversineDistanceMeters(
        geofence.latitude,
        geofence.longitude,
        location.latitude,
        location.longitude,
      );
      if (distanceMeters > geofence.radiusMeters) {
        throw new AppError(
          422,
          'OUTSIDE_GEOFENCE',
          'Anda berada di luar radius sekolah',
          {
            distanceMeters: roundedMeters(distanceMeters),
            radiusMeters: geofence.radiusMeters,
          },
        );
      }

      return CheckInRecordSchema.parse(
        await repository.saveCheckIn({
          teacherId,
          workDate,
          checkInAt: serverNow.toISOString(),
          location,
          distanceMeters: roundedMeters(distanceMeters),
          schedule: day.schedule,
          arrivalLateMinutes: Math.max(
            0,
            minuteOfDay - timeMinutes(day.schedule.workStart),
          ),
        }),
      );
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

export function registerAttendanceRoutes(
  app: Express,
  authService: AuthService,
  attendanceService: AttendanceService,
): void {
  const teacherGuards = [createSessionGuard(authService), requireRole('USER')];

  app.get(
    '/api/attendance/today',
    ...teacherGuards,
    async (request, response, next) => {
      try {
        response
          .status(200)
          .json(await attendanceService.getToday(teacherId(request)));
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
          .json(await attendanceService.checkIn(teacherId(request), parsed.data));
      } catch (error) {
        next(error);
      }
    },
  );
}
