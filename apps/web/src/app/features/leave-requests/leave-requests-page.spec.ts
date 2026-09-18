import type { LeaveRequest, LeaveRequestListResponse } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { vi } from 'vitest';

import { AttendanceService } from '../attendance/attendance.service';
import { AuthService } from '../../core/auth/auth.service';
import { LeaveRequestsPage } from './leave-requests-page';
import { LeaveRequestsService } from './leave-requests.service';

const pending: LeaveRequest = {
  id: '40000000-0000-4000-8000-000000000001', teacherId: '50000000-0000-4000-8000-000000000001', leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Perlu berobat', status: 'PENDING', decisionNote: null, decidedBy: null, decidedAt: null, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};
describe('LeaveRequestsPage', () => {
  let fixture: ComponentFixture<LeaveRequestsPage>;
  let create: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  let fetchOwn: ReturnType<typeof vi.fn>;
  let fetchToday: ReturnType<typeof vi.fn>;
  async function setup(
    result: LeaveRequestListResponse = { data: [pending], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } },
    role: 'USER' | 'SECURITY_GUARD' = 'USER',
  ) {
    create = vi.fn(async () => pending);
    cancel = vi.fn(async () => ({ ...pending, status: 'CANCELLED' as const }));
    fetchOwn = vi.fn(async () => result);
    fetchToday = vi.fn(async () => ({
      serverNow: '2026-09-06T00:00:00.000Z',
      workDate: '2026-09-06',
      state: 'CHECKED_IN',
      schedule: null,
      attendance: null,
      locationRequirement: { maxAccuracyMeters: 15 },
    }));
    await TestBed.configureTestingModule({
      imports: [LeaveRequestsPage], providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
        { provide: LeaveRequestsService, useValue: { fetchOwn, create, cancel } },
        {
          provide: AuthService,
          useValue: { user: signal({ role }) },
        },
        {
          provide: AttendanceService,
          useValue: {
            fetchToday,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveRequestsPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    await vi.waitFor(() => expect(fixture.componentInstance.todayQuery.isPending()).toBe(false));
    fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());
  it('renders the request form and existing statuses', async () => {
    await setup();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ajukan izin');
    expect(text).toContain('Menunggu keputusan');
    expect(text).toContain('Batalkan');
    expect(text).toContain('Rabu, 26 Agustus 2026');
  });
  it('submits a single-date request and prevents duplicate submission', async () => {
    await setup();
    const page = fixture.componentInstance;
    page.form.controls.leaveDate.setValue('2099-01-01');
    page.form.controls.leaveType.setValue('FAMILY');
    page.form.controls.reason.setValue('Acara keluarga');
    await Promise.all([page.submit(), page.submit()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ leaveDate: '2099-01-01', leaveType: 'FAMILY', reason: 'Acara keluarga' });
  });
  it('rejects a whitespace-only reason before calling the API', async () => {
    await setup();
    const page = fixture.componentInstance;
    page.form.controls.reason.setValue('   ');

    await page.submit();

    expect(create).not.toHaveBeenCalled();
    expect(page.form.controls.reason.invalid).toBe(true);
  });
  it('rejects a leave date before today on the client', async () => {
    await setup();
    const page = fixture.componentInstance;
    const yesterday = new Date(`${page.minDate}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    page.form.controls.leaveDate.setValue(yesterday.toISOString().slice(0, 10));
    page.form.controls.reason.setValue('Perlu berobat');

    await page.submit();

    expect(create).not.toHaveBeenCalled();
    expect(page.form.controls.leaveDate.hasError('pastDate')).toBe(true);
  });
  it('allows a Satpam to select yesterday for an overnight shift request', async () => {
    await setup(undefined, 'SECURITY_GUARD');
    const page = fixture.componentInstance;
    const yesterday = page.minDate;
    page.form.controls.leaveDate.setValue(yesterday);
    page.form.controls.reason.setValue('Sakit saat shift malam');

    await page.submit();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ leaveDate: yesterday }));
  });
  it('cancels only a pending request', async () => {
    await setup();
    await fixture.componentInstance.cancel(pending);
    expect(cancel).toHaveBeenCalledWith(pending.id);
  });

  it('disables an application for today after the teacher has checked in', async () => {
    await setup();
    fixture.componentInstance.form.controls.leaveDate.setValue('2026-09-06');
    fixture.detectChanges();

    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('disables every new leave submission while an active absence blocks operations', async () => {
    await setup();
    fetchToday.mockResolvedValue({
      serverNow: '2026-09-06T00:00:00.000Z', workDate: '2026-09-06', state: 'LEAVE_BLOCKED', schedule: null, attendance: null,
      operationalBlock: { leaveType: 'SICK', status: 'APPROVED', phase: 'SINGLE_DAY', blockedActions: ['CHECK_IN', 'CHECKOUT', 'EARLY_DEPARTURE', 'CREATE_LEAVE'] },
    });
    await fixture.componentInstance.todayQuery.refetch();
    await vi.waitFor(() => expect(fixture.componentInstance.isTodayLeaveBlocked()).toBe(true));
    fixture.detectChanges();
    fixture.componentInstance.form.controls.reason.setValue('Izin lain');

    await fixture.componentInstance.submit();

    expect(create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Pengajuan izin ditutup selama izin aktif');
  });
});
