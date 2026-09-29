import type {
  AttendanceHistoryResponse,
  CompletedAttendanceRecord,
  LocationInput,
} from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AttendanceService } from './attendance.service';

const completed: CompletedAttendanceRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:20.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 5,
  checkOutAt: '2026-08-25T08:35:59.000Z',
  checkOutLatitude: -6.2,
  checkOutLongitude: 106.816666,
  checkOutAccuracyMeters: 10,
  checkOutDistanceMeters: 0,
  workedMinutes: 510,
  workDeficitMinutes: 5,
  status: 'COMPLETED',
};

describe('AttendanceService checkout and history', () => {
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

  it('posts only LocationInput and validates the checkout response', async () => {
    const location: LocationInput = {
      latitude: -6.2,
      longitude: 106.816666,
      accuracyMeters: 10,
    };
    const promise = service.checkout(location);
    const request = http.expectOne('/api/attendance/checkout');

    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual(location);
    request.flush(completed);

    await expect(promise).resolves.toEqual(completed);
  });

  it('loads a validated month-filtered paginated history', async () => {
    const response: AttendanceHistoryResponse = {
      data: [completed],
      pagination: {
        page: 2,
        pageSize: 10,
        totalItems: 11,
        totalPages: 2,
      },
    };
    const promise = service.getHistory({
      page: 2,
      pageSize: 10,
      month: '2026-08',
    });
    const request = http.expectOne(
      '/api/attendance/history?page=2&pageSize=10&month=2026-08',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(response);

    await expect(promise).resolves.toEqual(response);
  });

  it('rejects malformed history responses at the browser boundary', async () => {
    const promise = service.getHistory({ page: 1, pageSize: 10 });
    http.expectOne('/api/attendance/history?page=1&pageSize=10').flush({
      data: [{ status: 'INCOMPLETE', checkOutAt: 'fake' }],
      pagination: {},
    });

    await expect(promise).rejects.toBeDefined();
  });
});
