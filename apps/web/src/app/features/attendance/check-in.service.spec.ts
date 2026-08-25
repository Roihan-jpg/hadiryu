import type {
  CheckInRecord,
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AttendanceService } from './attendance.service';

const today: TodayAttendanceResponse = {
  serverNow: '2026-08-25T00:00:00.000Z',
  workDate: '2026-08-25',
  state: 'READY_TO_CHECK_IN',
  schedule: {
    scheduleType: 'WEEKDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    workEnd: '15:35',
    targetMinutes: 515,
  },
  attendance: null,
};

const attendance: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:00:00.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 0,
  status: 'CHECKED_IN',
};

describe('AttendanceService check-in', () => {
  let service: AttendanceService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AttendanceService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the server-resolved state for today with cookies', async () => {
    const promise = service.getToday();
    const request = http.expectOne('/api/attendance/today');

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(today);

    await expect(promise).resolves.toEqual(today);
  });

  it('posts only LocationInput and validates the check-in response', async () => {
    const location: LocationInput = {
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    };
    const promise = service.checkIn(location);
    const request = http.expectOne('/api/attendance/check-in');

    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual(location);
    request.flush(attendance);

    await expect(promise).resolves.toEqual(attendance);
  });

  it('rejects malformed API responses at the browser boundary', async () => {
    const promise = service.getToday();
    http.expectOne('/api/attendance/today').flush({
      serverNow: 'waktu-browser',
      state: 'READY_TO_CHECK_IN',
    });

    await expect(promise).rejects.toBeDefined();
  });
});
