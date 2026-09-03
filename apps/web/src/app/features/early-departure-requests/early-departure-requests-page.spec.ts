import type { EarlyDepartureRequest } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
  const getToday = vi.fn(async () => ({
    serverNow: '2026-08-31T06:00:00.000Z',
    workDate: '2026-08-31',
    state: 'CHECKED_IN' as const,
    schedule: null,
    attendance: null,
    locationRequirement: { maxAccuracyMeters: 20 },
  }));
  const listOwn = vi.fn(async () => ({
    data: [],
    pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  }));

  beforeEach(async () => {
    create.mockClear();
    listOwn.mockClear();
    geolocation.getCurrentPosition.mockClear();
    await TestBed.configureTestingModule({
      imports: [EarlyDepartureRequestsPage],
      providers: [
        provideRouter([]),
        { provide: AttendanceService, useValue: { getToday } },
        { provide: EarlyDepartureRequestsService, useValue: { create, listOwn } },
        { provide: GEOLOCATION, useValue: geolocation },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(EarlyDepartureRequestsPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('requests location only after submit and prevents duplicate requests', async () => {
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
});
