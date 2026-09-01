import type {
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  CreatePayrollVersionRequest,
  CreateGeofenceVersionRequest,
  CreateScheduleVersionRequest,
  GeofenceSettingsResponse,
  PayrollSettingsResponse,
  ScheduleSettingsResponse,
} from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SettingsService } from './settings.service';

const schedules: ScheduleSettingsResponse = {
  effectiveOn: '2026-08-25',
  weekday: null,
  saturday: null,
};

const geofence: GeofenceSettingsResponse = {
  effectiveOn: '2026-08-25',
  geofence: null,
};

const calendar: CalendarExceptionsResponse = { exceptions: [] };
const payroll: PayrollSettingsResponse = {
  effectiveOn: '2026-08-25',
  payrollRule: null,
};

describe('SettingsService', () => {
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads schedule and geofence versions for an explicit date', async () => {
    const schedulePromise = service.getSchedules('2026-08-25');
    const scheduleRequest = http.expectOne(
      '/api/admin/settings/schedules?effectiveOn=2026-08-25',
    );
    expect(scheduleRequest.request.method).toBe('GET');
    expect(scheduleRequest.request.withCredentials).toBe(true);
    scheduleRequest.flush(schedules);

    const geofencePromise = service.getGeofence('2026-08-25');
    const geofenceRequest = http.expectOne(
      '/api/admin/settings/geofence?effectiveOn=2026-08-25',
    );
    expect(geofenceRequest.request.method).toBe('GET');
    geofenceRequest.flush(geofence);

    await expect(schedulePromise).resolves.toEqual(schedules);
    await expect(geofencePromise).resolves.toEqual(geofence);
  });

  it('posts new effective schedule and geofence versions', async () => {
    const scheduleInput: CreateScheduleVersionRequest = {
      effectiveFrom: '2026-09-01',
      weekday: {
        checkInOpen: '05:30',
        workStart: '07:00',
        checkInClose: '08:00',
        checkoutOpen: '12:00',
        workEnd: '15:35',
        checkoutClose: '17:00',
        targetMinutes: 515,
      },
      saturday: {
        checkInOpen: '05:30',
        workStart: '07:00',
        checkInClose: '08:00',
        checkoutOpen: '09:30',
        workEnd: '10:35',
        checkoutClose: '12:00',
        targetMinutes: 215,
      },
    };
    const geofenceInput: CreateGeofenceVersionRequest = {
      effectiveFrom: '2026-09-01',
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 100,
      maxAccuracyMeters: 50,
    };

    const schedulePromise = service.createSchedules(scheduleInput);
    const scheduleRequest = http.expectOne('/api/admin/settings/schedules');
    expect(scheduleRequest.request.method).toBe('POST');
    expect(scheduleRequest.request.body).toEqual(scheduleInput);
    scheduleRequest.flush({ ...schedules, effectiveOn: scheduleInput.effectiveFrom });

    const geofencePromise = service.createGeofence(geofenceInput);
    const geofenceRequest = http.expectOne('/api/admin/settings/geofence');
    expect(geofenceRequest.request.method).toBe('POST');
    expect(geofenceRequest.request.body).toEqual(geofenceInput);
    geofenceRequest.flush({ ...geofence, effectiveOn: geofenceInput.effectiveFrom });

    await schedulePromise;
    await geofencePromise;
  });

  it('rejects API responses outside the shared contracts', async () => {
    const promise = service.getGeofence('2026-08-25');
    http
      .expectOne('/api/admin/settings/geofence?effectiveOn=2026-08-25')
      .flush({ effectiveOn: 'bukan-tanggal', geofence: [] });

    await expect(promise).rejects.toBeDefined();
  });

  it('manages calendar exceptions and a globally versioned payroll rule', async () => {
    const calendarInput: CalendarExceptionInput = {
      workDate: '2026-12-25',
      exceptionType: 'HOLIDAY',
      name: 'Libur Natal',
      scheduleType: null,
    };
    const payrollInput: CreatePayrollVersionRequest = {
      effectiveFrom: '2026-09-01',
      basePerformancePay: 600_000,
      minimumPerformancePay: 300_000,
      lateDeductionAmount: 10_000,
      absentDeductionAmount: 20_000,
      rejectedEarlyDepartureRatePerHour: 10_000,
    };

    const listPromise = service.getCalendarExceptions();
    const listRequest = http.expectOne('/api/admin/settings/calendar');
    expect(listRequest.request.method).toBe('GET');
    listRequest.flush(calendar);

    const createPromise = service.createCalendarException(calendarInput);
    const createRequest = http.expectOne('/api/admin/settings/calendar');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(calendarInput);
    createRequest.flush({ id: '40000000-0000-4000-8000-000000000001', ...calendarInput });

    const payrollPromise = service.getPayroll('2026-08-25');
    const payrollRequest = http.expectOne(
      '/api/admin/settings/payroll?effectiveOn=2026-08-25',
    );
    expect(payrollRequest.request.method).toBe('GET');
    payrollRequest.flush(payroll);

    const createPayrollPromise = service.createPayroll(payrollInput);
    const createPayrollRequest = http.expectOne('/api/admin/settings/payroll');
    expect(createPayrollRequest.request.method).toBe('POST');
    expect(createPayrollRequest.request.body).toEqual(payrollInput);
    createPayrollRequest.flush({ ...payroll, effectiveOn: payrollInput.effectiveFrom });

    const id = '40000000-0000-4000-8000-000000000001';
    const updatePromise = service.updateCalendarException(id, {
      ...calendarInput,
      name: 'Libur Nasional',
    });
    const updateRequest = http.expectOne(`/api/admin/settings/calendar/${id}`);
    expect(updateRequest.request.method).toBe('PATCH');
    updateRequest.flush({ id, ...calendarInput, name: 'Libur Nasional' });

    const deletePromise = service.deleteCalendarException(id);
    const deleteRequest = http.expectOne(`/api/admin/settings/calendar/${id}`);
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush(null);

    await expect(listPromise).resolves.toEqual(calendar);
    await createPromise;
    await expect(payrollPromise).resolves.toEqual(payroll);
    await createPayrollPromise;
    await updatePromise;
    await deletePromise;
  });
});
