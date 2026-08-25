import type {
  AttendanceHistoryResponse,
  CheckInRecord,
  CompletedAttendanceRecord,
  IncompleteAttendanceRecord,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AttendanceService } from './attendance.service';
import { AttendanceHistoryPage } from './attendance-history-page';

const checkedIn: CheckInRecord = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-08-25',
  checkInAt: '2026-08-25T00:05:20.000Z',
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 10,
  distanceMeters: 0,
  workStart: '07:00',
  workEnd: '15:35',
  checkoutClose: '17:00',
  targetMinutes: 515,
  arrivalLateMinutes: 5,
  status: 'CHECKED_IN',
};
const completed: CompletedAttendanceRecord = {
  ...checkedIn,
  checkOutAt: '2026-08-25T08:35:59.000Z',
  checkOutLatitude: -6.2,
  checkOutLongitude: 106.816666,
  checkOutAccuracyMeters: 10,
  checkOutDistanceMeters: 0,
  workedMinutes: 510,
  workDeficitMinutes: 5,
  status: 'COMPLETED',
};
const incomplete: IncompleteAttendanceRecord = {
  ...checkedIn,
  id: '40000000-0000-4000-8000-000000000002',
  workDate: '2026-08-24',
  checkOutAt: null,
  workedMinutes: 455,
  workDeficitMinutes: 60,
  status: 'INCOMPLETE',
};
const response: AttendanceHistoryResponse = {
  data: [completed, incomplete],
  pagination: {
    page: 1,
    pageSize: 10,
    totalItems: 12,
    totalPages: 2,
  },
};

describe('AttendanceHistoryPage', () => {
  let fixture: ComponentFixture<AttendanceHistoryPage>;
  let getHistory: ReturnType<typeof vi.fn>;

  async function setup(result: AttendanceHistoryResponse = response): Promise<void> {
    getHistory = vi.fn(async () => result);
    await TestBed.configureTestingModule({
      imports: [AttendanceHistoryPage],
      providers: [
        provideRouter([]),
        { provide: AttendanceService, useValue: { getHistory } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AttendanceHistoryPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads the current month and renders completed and incomplete calculations', async () => {
    await setup();

    expect(getHistory).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Riwayat absensi');
    expect(text).toContain('Selesai');
    expect(text).toContain('510 menit');
    expect(text).toContain('Tidak lengkap');
    expect(text).toContain('455 menit');
    expect(text).toContain('Kekurangan60 menit');
  });

  it('resets pagination for a month change and requests the selected page', async () => {
    await setup();
    fixture.componentInstance.monthControl.setValue('2026-07');
    await fixture.componentInstance.applyMonth();
    await fixture.componentInstance.pageChanged({
      pageIndex: 1,
      pageSize: 10,
      length: 12,
      previousPageIndex: 0,
    });

    expect(getHistory).toHaveBeenNthCalledWith(2, {
      page: 1,
      pageSize: 10,
      month: '2026-07',
    });
    expect(getHistory).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 10,
      month: '2026-07',
    });
  });

  it('shows a clear empty state for a month without records', async () => {
    await setup({
      data: [],
      pagination: {
        page: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
      },
    });

    expect(fixture.nativeElement.textContent).toContain(
      'Belum ada absensi pada bulan ini',
    );
  });
});
