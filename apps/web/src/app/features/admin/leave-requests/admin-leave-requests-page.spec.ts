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
  let open: ReturnType<typeof vi.fn>;
  async function setup(result: AdminLeaveRequestListResponse = { data: [pending], pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }) {
    decide = vi.fn(async () => ({ ...pending, status: 'APPROVED' as const }));
    open = vi.fn(() => ({ afterClosed: () => of({ decisionNote: 'Data sesuai' }) }));
    await TestBed.configureTestingModule({
      imports: [AdminLeaveRequestsPage], providers: [provideRouter([]), {
        provide: LeaveRequestsService, useValue: { listAdmin: vi.fn(async () => result), decide },
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
    expect(fixture.nativeElement.textContent).toContain('Approval izin');
    expect(fixture.nativeElement.textContent).toContain('Guru Satu');
    expect(fixture.nativeElement.textContent).toContain('Setujui');
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
});
