import type { Teacher, TeacherListResponse } from '@absensi/contracts';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of, type Observable } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from '../../../core/auth/auth.service';
import { TeachersPage } from './teachers-page';
import { TeachersService } from './teachers.service';

const teacher: Teacher = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '19870001',
  fullName: 'Guru Contoh',
  whatsappNumber: null,
  isActive: true,
  mustChangePassword: false,
  temporaryPasswordExpiresAt: null,
  createdAt: '2026-08-25T01:00:00.000Z',
  updatedAt: '2026-08-25T01:00:00.000Z',
};

const response: TeacherListResponse = {
  data: [teacher],
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  },
};

describe('TeachersPage', () => {
  let fixture: ComponentFixture<TeachersPage>;
  const list = vi.fn(async () => response);
  const create = vi.fn(async () => teacher);
  const update = vi.fn(async () => teacher);
  const setActive = vi.fn(async () => ({ ...teacher, isActive: false }));
  const resetPassword = vi.fn(async () => ({
    teacher,
    newPassword: 'Baru1234',
  }));
  const open = vi.fn(() => ({
    afterClosed: (): Observable<unknown> => of(undefined),
  }));

  beforeEach(async () => {
    list.mockClear();
    create.mockClear();
    update.mockClear();
    setActive.mockClear();
    resetPassword.mockClear();
    open.mockClear();
    await TestBed.configureTestingModule({
      imports: [TeachersPage],
      providers: [
        provideRouter([]),
        {
          provide: TeachersService,
          useValue: { list, create, update, setActive, resetPassword },
        },
        {
          provide: AuthService,
          useValue: {
            user: signal({
              id: '6ebefbc7-8bda-4202-8d9e-95441f0acb03',
              nip: 'admin-001',
              fullName: 'Admin Sekolah',
              role: 'SUPER_ADMIN' as const,
              isActive: true,
              mustChangePassword: false,
            }).asReadonly(),
          },
        },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: { open } });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(TeachersPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads and renders the paginated teacher table', () => {
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(fixture.nativeElement.textContent).toContain('Guru Contoh');
    expect(fixture.nativeElement.textContent).toContain('19870001');
    expect(fixture.nativeElement.querySelector('mat-paginator')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.table-frame')?.tabIndex).toBe(0);
  });

  it('restarts at page one when applying a trimmed search', async () => {
    fixture.componentInstance.searchControl.setValue('  Siti  ');
    await fixture.componentInstance.applySearch();

    expect(list).toHaveBeenLastCalledWith({
      search: 'Siti',
      page: 1,
      pageSize: 20,
    });
  });

  it('prevents duplicate status actions while a request is in progress', async () => {
    let finish!: (value: Teacher) => void;
    setActive.mockImplementationOnce(
      () => new Promise<Teacher>((resolve) => (finish = resolve)),
    );

    const first = fixture.componentInstance.changeActiveStatus(teacher);
    const second = fixture.componentInstance.changeActiveStatus(teacher);
    expect(setActive).toHaveBeenCalledTimes(1);
    finish({ ...teacher, isActive: false });
    await Promise.all([first, second]);
  });

  it('connects create and edit dialogs to their profile operations', async () => {
    open.mockReturnValueOnce({
      afterClosed: () =>
        of({
          nip: '19870002',
          fullName: 'Guru Baru',
          initialPassword: 'Sementara-123',
          whatsappNumber: null,
        }),
    });
    fixture.componentInstance.openCreateDialog();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({
      nip: '19870002',
      fullName: 'Guru Baru',
      initialPassword: 'Sementara-123',
      whatsappNumber: null,
    }));
    await vi.waitFor(() => expect(fixture.componentInstance.actionInProgress()).toBeNull());

    open.mockReturnValueOnce({
      afterClosed: () => of({ nip: '19870003', fullName: 'Nama Baru', whatsappNumber: null }),
    });
    fixture.componentInstance.openEditDialog(teacher);
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(teacher.id, {
      nip: '19870003',
      fullName: 'Nama Baru',
      whatsappNumber: null,
    }));
  });

  it('connects confirmation and reset dialogs to sensitive operations', async () => {
    open.mockReturnValueOnce({ afterClosed: () => of(true) });
    fixture.componentInstance.confirmActiveStatus(teacher);
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledWith(teacher.id, false));
    await vi.waitFor(() => expect(fixture.componentInstance.actionInProgress()).toBeNull());

    open.mockReturnValueOnce({
      afterClosed: () => of(true),
    });
    fixture.componentInstance.openResetPasswordDialog(teacher);
    await vi.waitFor(() => expect(resetPassword).toHaveBeenCalledWith(teacher.id));
  });

  it('shows a clear empty state', async () => {
    list.mockResolvedValueOnce({
      data: [],
      pagination: { ...response.pagination, totalItems: 0, totalPages: 0 },
    });
    await fixture.componentInstance.loadTeachers();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Guru tidak ditemukan');
  });
});
