import type { LeaveRequest, LeaveRequestListResponse } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { LeaveRequestsPage } from './leave-requests-page';
import { LeaveRequestsService } from './leave-requests.service';

const pending: LeaveRequest = {
  id: '40000000-0000-4000-8000-000000000001', teacherId: '50000000-0000-4000-8000-000000000001', leaveDate: '2026-08-26', leaveType: 'SICK', reason: 'Perlu berobat', status: 'PENDING', decisionNote: null, decidedBy: null, decidedAt: null, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};
describe('LeaveRequestsPage', () => {
  let fixture: ComponentFixture<LeaveRequestsPage>;
  let create: ReturnType<typeof vi.fn>;
  let cancel: ReturnType<typeof vi.fn>;
  async function setup(result: LeaveRequestListResponse = { data: [pending], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 } }) {
    create = vi.fn(async () => pending);
    cancel = vi.fn(async () => ({ ...pending, status: 'CANCELLED' as const }));
    await TestBed.configureTestingModule({
      imports: [LeaveRequestsPage], providers: [provideRouter([]), {
        provide: LeaveRequestsService, useValue: { listOwn: vi.fn(async () => result), create, cancel },
      }],
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveRequestsPage);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  }
  afterEach(() => TestBed.resetTestingModule());
  it('renders the request form and existing statuses', async () => {
    await setup();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ajukan izin');
    expect(text).toContain('Menunggu keputusan');
    expect(text).toContain('Batalkan');
  });
  it('submits a single-date request and prevents duplicate submission', async () => {
    await setup();
    const page = fixture.componentInstance;
    page.form.controls.leaveDate.setValue('2026-08-27');
    page.form.controls.leaveType.setValue('FAMILY');
    page.form.controls.reason.setValue('Acara keluarga');
    await Promise.all([page.submit(), page.submit()]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ leaveDate: '2026-08-27', leaveType: 'FAMILY', reason: 'Acara keluarga' });
  });
  it('rejects a whitespace-only reason before calling the API', async () => {
    await setup();
    const page = fixture.componentInstance;
    page.form.controls.reason.setValue('   ');

    await page.submit();

    expect(create).not.toHaveBeenCalled();
    expect(page.form.controls.reason.invalid).toBe(true);
  });
  it('cancels only a pending request', async () => {
    await setup();
    await fixture.componentInstance.cancel(pending);
    expect(cancel).toHaveBeenCalledWith(pending.id);
  });
});
