import type { AdminLeaveRequest, AdminLeaveRequestListResponse } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AdminLeaveRequestsPage } from './admin-leave-requests-page';
import { LeaveRequestsService } from '../../leave-requests/leave-requests.service';

const pending: AdminLeaveRequest = {
  id: '40000000-0000-4000-8000-000000000001', teacherId: '50000000-0000-4000-8000-000000000001', teacherNip: '1987001', teacherFullName: 'Guru Satu', leaveDate: '2026-08-26', leaveType: 'OFFICIAL_DUTY', reason: 'Dinas kecamatan', status: 'PENDING', decisionNote: null, decidedBy: null, decidedAt: null, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};
describe('AdminLeaveRequestsPage', () => {
  let fixture: ComponentFixture<AdminLeaveRequestsPage>;
  let decide: ReturnType<typeof vi.fn>;
  let listAdmin: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  async function setup(result: AdminLeaveRequestListResponse = { data: [pending], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }) {
    decide = vi.fn(async () => ({ ...pending, status: 'APPROVED' as const }));
    listAdmin = vi.fn(async () => result);
    open = vi.fn(() => ({ afterClosed: () => of({ decisionNote: 'Data sesuai' }) }));
    await TestBed.configureTestingModule({
      imports: [AdminLeaveRequestsPage], providers: [provideRouter([]), {
        provide: LeaveRequestsService, useValue: { listAdmin, decide },
      }],
    });
    TestBed.overrideProvider(MatDialog, { useValue: { open } });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(AdminLeaveRequestsPage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());
  it('renders pending approvals and filters them by status', async () => {
    await setup();
    expect(fixture.nativeElement.textContent).toContain('Approval Izin');
    expect(fixture.nativeElement.textContent).toContain('Guru Satu');
    expect(fixture.nativeElement.textContent).toContain('Lihat detail');
  });
  it('submits an approval only once while it is in progress', async () => {
    await setup();
    const page = fixture.componentInstance;
    await Promise.all([page.decide(pending, 'APPROVED'), page.decide(pending, 'APPROVED')]);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(pending.id, 'APPROVED', undefined);
  });
  it('opens an isolated confirmation dialog for the selected request', async () => {
    await setup();

    fixture.componentInstance.openDecision(pending, 'REJECTED');
    await fixture.whenStable();

    expect(open).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(
      pending.id,
      'REJECTED',
      { decisionNote: 'Data sesuai' },
    );
  });
  it('does not show an empty result together with an error', async () => {
    await setup({ data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
    fixture.componentInstance.errorMessage.set('Daftar approval gagal dimuat.');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Daftar approval gagal dimuat.');
    expect(text).not.toContain('Tidak ada pengajuan izin yang sesuai filter.');
  });
  it('prevents native navigation when submitting the filter form', async () => {
    await setup();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });

    form.dispatchEvent(event);
    await fixture.whenStable();

    expect(event.defaultPrevented).toBe(true);
    expect(listAdmin).toHaveBeenCalledTimes(2);
  });
});
