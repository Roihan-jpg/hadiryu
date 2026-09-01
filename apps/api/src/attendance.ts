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
  type ListAttendanceHistoryQuery,
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

export interface SaveCheckoutInput {
  attendanceId: string;
  teacherId: string;
  workDate: string;
  checkOutAt: string;
  location: LocationInput;
  distanceMeters: number;
  workedMinutes: number;
  workDeficitMinutes: number;
}

export type PersistedAttendanceRecord =
  | CheckInRecord
  | CompletedAttendanceRecord;

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
  findGeofence(workDate: string): Promise<GeofenceRule | null>;
  hasApprovedLeave(teacherId: string, workDate: string): Promise<boolean>;
  saveCheckIn(input: SaveCheckInInput): Promise<PersistedAttendanceRecord>;
  saveCheckout(input: SaveCheckoutInput): Promise<CompletedAttendanceRecord>;
  listAttendanceHistory(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<{ records: PersistedAttendanceRecord[]; totalItems: number }>;
}

export interface AttendanceService {
  getToday(teacherId: string): Promise<TodayAttendanceResponse>;
  checkIn(teacherId: string, location: LocationInput): Promise<AttendanceRecord>;
  checkout(
    teacherId: string,
    location: LocationInput,
  ): Promise<CompletedAttendanceRecord>;
  history(
    teacherId: string,
    input: ListAttendanceHistoryQuery,
  ): Promise<AttendanceHistoryResponse>;
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

export function validatedDistance(
  location: LocationInput,
  geofence: GeofenceRule,
): number {
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
    throw new AppError(422, 'OUTSIDE_GEOFENCE', 'Anda berada di luar radius sekolah', {
      distanceMeters: roundedMeters(distanceMeters),
      radiusMeters: geofence.radiusMeters,
    });
  }
  return roundedMeters(distanceMeters);
}

function derivedAttendance(
  attendance: PersistedAttendanceRecord,
  serverNow: Date,
): AttendanceRecord {
  if (attendance.status === 'COMPLETED') return attendance;
  const current = jakartaDateTime(serverNow);
  const cutoffPassed =
    attendance.workDate < current.workDate ||
    (attendance.workDate === current.workDate &&
      current.minuteOfDay > timeMinutes(attendance.checkoutClose));
  if (!cutoffPassed) return attendance;
  return IncompleteAttendanceRecordSchema.parse({
    ...attendance,
    checkOutAt: null,
    workedMinutes: Math.max(0, attendance.targetMinutes - 60),
    workDeficitMinutes: Math.min(60, attendance.targetMinutes),
    status: 'INCOMPLETE',
  });
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
        const attendance = derivedAttendance(existing, serverNow);
        const day = await resolveDay(repository, workDate);
        return TodayAttendanceResponseSchema.parse({
          serverNow: serverNow.toISOString(),
          workDate,
          state: attendance.status,
          schedule: day.schedule ? todaySchedule(day.schedule) : null,
          attendance,
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
      const distanceMeters = validatedDistance(location, geofence);

      return AttendanceRecordSchema.parse(
        await repository.saveCheckIn({
          teacherId,
          workDate,
          checkInAt: serverNow.toISOString(),
          location,
          distanceMeters,
          schedule: day.schedule,
          arrivalLateMinutes: Math.max(
            0,
            minuteOfDay - timeMinutes(day.schedule.workStart),
          ),
        }),
      );
    },

    async checkout(teacherId, location) {
      const serverNow = now();
      const { workDate, minuteOfDay } = jakartaDateTime(serverNow);
      const existing = await repository.findAttendance(teacherId, workDate);
      if (!existing) {
        throw new AppError(
          409,
          'CHECK_IN_REQUIRED',
          'Checkout hanya dapat dilakukan setelah check-in',
        );
      }
      if (existing.status === 'COMPLETED') return existing;

      const day = await resolveDay(repository, workDate);
      if (!day.schedule) {
        throw new AppError(
          422,
          'SCHEDULE_NOT_CONFIGURED',
          'Jadwal untuk hari ini belum dikonfigurasi',
        );
      }
      if (
        minuteOfDay < timeMinutes(day.schedule.checkoutOpen) ||
        minuteOfDay > timeMinutes(existing.checkoutClose)
      ) {
        throw new AppError(
          422,
          'OUTSIDE_ATTENDANCE_WINDOW',
          'Checkout hanya dapat dilakukan pada jadwal yang ditentukan',
          {
            checkoutOpen: day.schedule.checkoutOpen,
            checkoutClose: existing.checkoutClose,
          },
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
      const distanceMeters = validatedDistance(location, geofence);
      const workedMinutes = Math.max(
        0,
        Math.floor(
          (serverNow.getTime() - new Date(existing.checkInAt).getTime()) / 60_000,
        ),
      );
      return CompletedAttendanceRecordSchema.parse(
        await repository.saveCheckout({
          attendanceId: existing.id,
          teacherId,
          workDate,
          checkOutAt: serverNow.toISOString(),
          location,
          distanceMeters,
          workedMinutes,
          workDeficitMinutes: Math.max(
            0,
            existing.targetMinutes - workedMinutes,
          ),
        }),
      );
    },

    async history(teacherId, input) {
      const query = ListAttendanceHistoryQuerySchema.parse(input);
      const result = await repository.listAttendanceHistory(teacherId, query);
      const serverNow = now();
      const totalItems = result.totalItems;
      return AttendanceHistoryResponseSchema.parse({
        data: result.records.map((record) =>
          AttendanceRecordSchema.parse(derivedAttendance(record, serverNow)),
        ),
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
          .json(await attendanceService.checkout(teacherId(request), parsed.data));
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
