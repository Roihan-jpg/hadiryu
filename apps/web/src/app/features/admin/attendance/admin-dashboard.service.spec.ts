import type {
  AdminAttendanceListResponse,
  AttendanceAdminNote,
} from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AdminDashboardService } from './admin-dashboard.service';

const response: AdminAttendanceListResponse = {
  summary: {
    workDate: '2026-08-25',
    generatedAt: '2026-08-25T01:00:00.000Z',
    present: 1,
    late: 0,
    notPresent: 0,
    incomplete: 0,
    leave: 0,
    off: 0,
    total: 1,
  },
  data: [
    {
      teacherId: '50000000-0000-4000-8000-000000000001',
      teacherNip: '1987001',
      teacherFullName: 'Guru Satu',
      workDate: '2026-08-25',
      status: 'PRESENT',
      attendanceId: '40000000-0000-4000-8000-000000000001',
      checkInAt: '2026-08-25T00:00:00.000Z',
      checkOutAt: null,
      workedMinutes: null,
      workDeficitMinutes: null,
      arrivalLateMinutes: 0,
      leaveType: null,
      notes: [],
    },
  ],
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  },
};

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminDashboardService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads validated daily monitoring with all filters and pagination', async () => {
    const promise = service.list({
      workDate: '2026-08-25',
      status: 'LATE',
      search: 'Guru Satu',
      page: 2,
      pageSize: 10,
    });
    const request = http.expectOne(
      '/api/admin/attendance?page=2&pageSize=10&workDate=2026-08-25&status=LATE&search=Guru%20Satu',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(response);

    await expect(promise).resolves.toEqual(response);
  });

  it('appends a validated note without correction fields', async () => {
    const attendanceId = response.data[0]!.attendanceId!;
    const note: AttendanceAdminNote = {
      id: '60000000-0000-4000-8000-000000000001',
      attendanceId,
      note: 'Dokumen sudah diperiksa',
      createdBy: '50000000-0000-4000-8000-000000000099',
      createdByFullName: 'Admin Sekolah',
      createdAt: '2026-08-25T10:05:00.000Z',
    };
    const promise = service.addNote(attendanceId, {
      note: 'Dokumen sudah diperiksa',
    });
    const request = http.expectOne(
      `/api/admin/attendance/${attendanceId}/notes`,
    );

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ note: 'Dokumen sudah diperiksa' });
    request.flush({ note });

    await expect(promise).resolves.toEqual(note);
  });

  it('rejects a summary that does not match its detail status counts', async () => {
    const promise = service.list({ page: 1, pageSize: 20 });
    http.expectOne('/api/admin/attendance?page=1&pageSize=20').flush({
      ...response,
      summary: { ...response.summary, total: 2 },
    });

    await expect(promise).rejects.toBeDefined();
  });
});
