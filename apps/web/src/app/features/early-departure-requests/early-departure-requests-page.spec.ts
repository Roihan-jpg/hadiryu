import type { EarlyDepartureRequest, EarlyDepartureRequestListResponse, TodayAttendanceResponse } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AttendanceService } from '../attendance/attendance.service';
import { GEOLOCATION } from '../attendance/geolocation';
import { EarlyDepartureRequestsPage } from './early-departure-requests-page';
import { EarlyDepartureRequestsService } from './early-departure-requests.service';

const pending: EarlyDepartureRequest = {
  id: '40000000-0000-4000-8000-000000000001',
  attendanceId: '40000000-0000-4000-8000-000000000002',
  teacherId: '50000000-0000-4000-8000-000000000001',
  workDate: '2026-08-31',
  requestedAt: '2026-08-31T06:00:00.000Z',
  reason: 'Keperluan keluarga',
  latitude: -8.1328,
  longitude: 113.2219,
  accuracyMeters: 10,
  distanceMeters: 0,
  status: 'PENDING',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-31T06:00:00.000Z',
  updatedAt: '2026-08-31T06:00:00.000Z',
};

const checkedInToday: TodayAttendanceResponse = {
  serverNow: '2026-08-31T06:00:00.000Z',
  workDate: '2026-08-31',
  state: 'CHECKED_IN',
  schedule: null,
  attendance: {
    id: '40000000-0000-4000-8000-000000000002',
    workDate: '2026-08-31',
    checkInAt: '2026-08-31T00:00:00.000Z',
    latitude: -8.1328,
    longitude: 113.2219,
    accuracyMeters: 10,
    distanceMeters: 0,
    workStart: '07:00',
    workEnd: '15:00',
    checkoutClose: '17:00',
    targetMinutes: 480,
    arrivalLateMinutes: 0,
    status: 'CHECKED_IN',
  },
  locationRequirement: { maxAccuracyMeters: 20 },
};

const completedToday: TodayAttendanceResponse = {
  ...checkedInToday,
  state: 'COMPLETED',
  attendance: {
    ...checkedInToday.attendance,
    checkOutAt: '2026-08-31T06:00:00.000Z',
    checkOutLatitude: -8.1328,
    checkOutLongitude: 113.2219,
    checkOutAccuracyMeters: 10,
    checkOutDistanceMeters: 0,
    workedMinutes: 360,
    workDeficitMinutes: 120,
    status: 'COMPLETED',
  },
};

class FakeGeolocation {
  success?: PositionCallback;
  readonly getCurrentPosition = vi.fn((success: PositionCallback) => {
    this.success = success;
  });
}

describe('EarlyDepartureRequestsPage', () => {
  let fixture: ComponentFixture<EarlyDepartureRequestsPage>;
  const geolocation = new FakeGeolocation();
  const create = vi.fn(async () => pending);
  const fetchToday = vi.fn<() => Promise<TodayAttendanceResponse>>(async () => checkedInToday);
  const listOwn = vi.fn(async (): Promise<EarlyDepartureRequestListResponse> => ({
    data: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  }));

  async function setup(today = checkedInToday): Promise<void> {
    create.mockClear();
    listOwn.mockClear();
    geolocation.getCurrentPosition.mockClear();
    fetchToday.mockReset();
    fetchToday.mockResolvedValue(today);
    await TestBed.configureTestingModule({
      imports: [EarlyDepartureRequestsPage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
        { provide: AttendanceService, useValue: { fetchToday } },
        { provide: EarlyDepartureRequestsService, useValue: { create, fetchOwn: listOwn } },
        { provide: GEOLOCATION, useValue: geolocation },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EarlyDepartureRequestsPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    await vi.waitFor(() => expect(fixture.componentInstance.todayQuery.isPending()).toBe(false));
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('requests location only after submit and prevents duplicate requests', async () => {
    await setup();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    fixture.componentInstance.form.controls.reason.setValue('Keperluan keluarga');

    const first = fixture.componentInstance.submit();
    const second = fixture.componentInstance.submit();
    await Promise.resolve();
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    geolocation.success?.({
      coords: {
        latitude: -8.1328,
        longitude: 113.2219,
        accuracy: 18,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });
    await Promise.all([first, second]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      reason: 'Keperluan keluarga',
      latitude: -8.1328,
      longitude: 113.2219,
      accuracyMeters: 18,
    });
  });

  it('disables submission after checkout has been recorded', async () => {
    await setup(completedToday);

    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('makes pending, approved, and rejected request outcomes visually distinct', async () => {
    listOwn.mockResolvedValue({
      data: [
        pending,
        { ...pending, id: '40000000-0000-4000-8000-000000000003', status: 'APPROVED', decisionNote: 'Disetujui untuk urusan keluarga.' },
        { ...pending, id: '40000000-0000-4000-8000-000000000004', status: 'REJECTED', decisionNote: 'Mohon selesaikan jadwal mengajar terlebih dahulu.' },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 },
    });
    await setup();

    const statuses = fixture.nativeElement.querySelectorAll('.request-status') as NodeListOf<HTMLElement>;
    expect(statuses).toHaveLength(3);
    expect(statuses[0]?.textContent).toContain('Menunggu keputusan admin');
    expect(statuses[1]?.classList.contains('request-status--approved')).toBe(true);
    expect(statuses[2]?.classList.contains('request-status--rejected')).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.admin-note')).toHaveLength(2);
  });
});
