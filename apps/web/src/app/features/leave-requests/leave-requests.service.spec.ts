import type {
  AdminLeaveRequest,
  AdminLeaveRequestListResponse,
  LeaveRequest,
  LeaveRequestListResponse,
} from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { LeaveRequestsService } from './leave-requests.service';

const pending: LeaveRequest = {
  id: '40000000-0000-4000-8000-000000000001',
  teacherId: '50000000-0000-4000-8000-000000000001',
  leaveDate: '2026-08-26',
  leaveType: 'SICK',
  reason: 'Perlu berobat',
  status: 'PENDING',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

const adminPending: AdminLeaveRequest = {
  ...pending,
  teacherNip: '1987001',
  teacherFullName: 'Guru Satu',
};

describe('LeaveRequestsService', () => {
  let service: LeaveRequestsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LeaveRequestsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads a validated status-filtered teacher list', async () => {
    const response: LeaveRequestListResponse = {
      data: [pending],
      pagination: { page: 2, pageSize: 10, totalItems: 11, totalPages: 2 },
    };
    const promise = service.listOwn({ page: 2, pageSize: 10, status: 'PENDING' });
    const request = http.expectOne('/api/leave-requests?page=2&pageSize=10&status=PENDING');

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(response);

    await expect(promise).resolves.toEqual(response);
  });

  it('creates and cancels a single-date request', async () => {
    const input = {
      leaveDate: '2026-08-26',
      leaveType: 'SICK' as const,
      reason: 'Perlu berobat',
    };
    const createPromise = service.create(input);
    const createRequest = http.expectOne('/api/leave-requests');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.body).toEqual(input);
    createRequest.flush({ leaveRequest: pending });

    const cancelPromise = service.cancel(pending.id);
    const cancelRequest = http.expectOne(`/api/leave-requests/${pending.id}/cancel`);
    expect(cancelRequest.request.method).toBe('POST');
    expect(cancelRequest.request.body).toEqual({});
    cancelRequest.flush({ leaveRequest: { ...pending, status: 'CANCELLED' } });

    await expect(createPromise).resolves.toEqual(pending);
    await expect(cancelPromise).resolves.toMatchObject({ status: 'CANCELLED' });
  });

  it('passes all admin filters and a decision note to the correct endpoint', async () => {
    const listResponse: AdminLeaveRequestListResponse = {
      data: [adminPending],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    };
    const listPromise = service.listAdmin({
      page: 1,
      pageSize: 20,
      status: 'PENDING',
      leaveDate: '2026-08-26',
      search: 'Guru Satu',
    });
    const listRequest = http.expectOne(
      '/api/admin/leave-requests?page=1&pageSize=20&status=PENDING&leaveDate=2026-08-26&search=Guru%20Satu',
    );
    expect(listRequest.request.method).toBe('GET');
    listRequest.flush(listResponse);

    const decisionPromise = service.decide(
      pending.id,
      'REJECTED',
      { decisionNote: 'Data belum cukup' },
    );
    const decisionRequest = http.expectOne(
      `/api/admin/leave-requests/${pending.id}/reject`,
    );
    expect(decisionRequest.request.method).toBe('POST');
    expect(decisionRequest.request.body).toEqual({ decisionNote: 'Data belum cukup' });
    decisionRequest.flush({
      leaveRequest: {
        ...pending,
        status: 'REJECTED',
        decisionNote: 'Data belum cukup',
        decidedBy: '50000000-0000-4000-8000-000000000002',
        decidedAt: '2026-08-25T01:00:00.000Z',
      },
    });

    await expect(listPromise).resolves.toEqual(listResponse);
    await expect(decisionPromise).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('rejects malformed API responses at the browser boundary', async () => {
    const promise = service.listOwn({ page: 1, pageSize: 10 });
    http.expectOne('/api/leave-requests?page=1&pageSize=10').flush({
      data: [{ ...pending, status: 'APPROVED' }],
      pagination: {},
    });

    await expect(promise).rejects.toBeDefined();
  });
});
