import type {
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  SaveGeofenceSettingsRequest,
  SaveScheduleSettingsRequest,
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

  it('posts schedule and geofence settings without client dates', async () => {
    const scheduleInput: SaveScheduleSettingsRequest = {
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
    const geofenceInput: SaveGeofenceSettingsRequest = {
      latitude: -6.2,
      longitude: 106.816666,
      radiusMeters: 100,
      maxAccuracyMeters: 50,
    };

    const schedulePromise = service.saveSchedules(scheduleInput);
    const scheduleRequest = http.expectOne('/api/admin/settings/schedules');
    expect(scheduleRequest.request.method).toBe('POST');
    expect(scheduleRequest.request.body).toEqual(scheduleInput);
    scheduleRequest.flush({ ...schedules, effectiveOn: '2026-09-01' });

    const geofencePromise = service.saveGeofence(geofenceInput);
    const geofenceRequest = http.expectOne('/api/admin/settings/geofence');
    expect(geofenceRequest.request.method).toBe('POST');
    expect(geofenceRequest.request.body).toEqual(geofenceInput);
    geofenceRequest.flush({ ...geofence, effectiveOn: '2026-09-01' });

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

  it('manages calendar exceptions', async () => {
    const calendarInput: CalendarExceptionInput = {
      workDate: '2026-12-25',
      exceptionType: 'HOLIDAY',
      name: 'Libur Natal',
      scheduleType: null,
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
    await updatePromise;
    await deletePromise;
  });
});
