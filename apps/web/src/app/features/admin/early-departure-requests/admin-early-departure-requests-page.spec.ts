import type { AdminEarlyDepartureRequest } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { EarlyDepartureRequestsService } from '../../early-departure-requests/early-departure-requests.service';
import { AdminEarlyDepartureRequestsPage } from './admin-early-departure-requests-page';

const pending: AdminEarlyDepartureRequest = {
  id: '40000000-0000-4000-8000-000000000001',
  attendanceId: '40000000-0000-4000-8000-000000000002',
  teacherId: '50000000-0000-4000-8000-000000000001',
  teacherNip: '1987001',
  teacherFullName: 'Guru Satu',
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

describe('AdminEarlyDepartureRequestsPage', () => {
  let fixture: ComponentFixture<AdminEarlyDepartureRequestsPage>;
  const listAdmin = vi.fn(async () => ({
    data: [pending],
    pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
  }));
  const decide = vi.fn(async () => ({
    ...pending,
    status: 'APPROVED' as const,
    decidedBy: '50000000-0000-4000-8000-000000000002',
    decidedAt: pending.createdAt,
  }));

  beforeEach(async () => {
    listAdmin.mockClear();
    decide.mockClear();
    await TestBed.configureTestingModule({
      imports: [AdminEarlyDepartureRequestsPage],
      providers: [
        provideRouter([]),
        { provide: EarlyDepartureRequestsService, useValue: { listAdmin, decide } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminEarlyDepartureRequestsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
  });

  it('loads Pending requests and links decisions to the detail page', async () => {
    expect(fixture.nativeElement.textContent).toContain('Guru Satu');
    const link = fixture.nativeElement.querySelector('a[href*="early-departure-requests"]');
    expect(link).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
  });

  it('applies the selected filters when the form is submitted', async () => {
    fixture.componentInstance.statusControl.setValue('APPROVED');
    fixture.componentInstance.dateControl.setValue('2026-09-05');
    fixture.componentInstance.searchControl.setValue('  Guru Dua  ');

    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(listAdmin).toHaveBeenCalledTimes(2));
    expect(listAdmin).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 100,
      status: 'APPROVED',
      workDate: '2026-09-05',
      search: 'Guru Dua',
    });
  });
});
