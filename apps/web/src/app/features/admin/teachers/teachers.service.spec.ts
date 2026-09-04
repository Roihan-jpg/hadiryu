import type { Teacher, TeacherListResponse } from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TeachersService } from './teachers.service';

const teacher: Teacher = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '19870001',
  fullName: 'Guru Contoh',
  whatsappNumber: null,
  isActive: true,
  mustChangePassword: true,
  temporaryPasswordExpiresAt: null,
  createdAt: '2026-08-25T01:00:00.000Z',
  updatedAt: '2026-08-25T01:00:00.000Z',
};

describe('TeachersService', () => {
  let service: TeachersService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TeachersService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads a paginated search through the admin API', async () => {
    const response: TeacherListResponse = {
      data: [teacher],
      pagination: {
        page: 2,
        pageSize: 25,
        totalItems: 30,
        totalPages: 2,
      },
    };
    const resultPromise = service.list({ search: 'Guru', page: 2, pageSize: 25 });
    const request = http.expectOne(
      '/api/admin/teachers?search=Guru&page=2&pageSize=25',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(response);

    await expect(resultPromise).resolves.toEqual(response);
  });

  it('calls create, update, status, and reset endpoints without leaking response secrets', async () => {
    const createPromise = service.create({
      nip: teacher.nip,
      fullName: teacher.fullName,
      initialPassword: 'Sementara-123',
    });
    http.expectOne('/api/admin/teachers').flush({ teacher });
    await expect(createPromise).resolves.toEqual(teacher);

    const updatePromise = service.update(teacher.id, { fullName: 'Nama Baru' });
    http
      .expectOne(`/api/admin/teachers/${teacher.id}`)
      .flush({ teacher: { ...teacher, fullName: 'Nama Baru' } });
    await expect(updatePromise).resolves.toMatchObject({ fullName: 'Nama Baru' });

    const statusPromise = service.setActive(teacher.id, false);
    http
      .expectOne(`/api/admin/teachers/${teacher.id}/deactivate`)
      .flush({ teacher: { ...teacher, isActive: false } });
    await expect(statusPromise).resolves.toMatchObject({ isActive: false });

    const resetPromise = service.resetPassword(teacher.id);
    http
      .expectOne(`/api/admin/teachers/${teacher.id}/reset-password`)
      .flush({ teacher, newPassword: 'Baru1234' });
    await expect(resetPromise).resolves.toMatchObject({ newPassword: 'Baru1234' });
  });

  it('rejects a response outside the shared teacher contract', async () => {
    const resultPromise = service.list({ page: 1, pageSize: 20 });
    http.expectOne('/api/admin/teachers?page=1&pageSize=20').flush({
      data: [{ id: teacher.id, nip: teacher.nip }],
      pagination: {},
    });

    await expect(resultPromise).rejects.toBeDefined();
  });
});
