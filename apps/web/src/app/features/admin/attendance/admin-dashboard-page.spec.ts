import type {
  AdminDashboardResponse,
  AdminAttendanceListResponse,
  AdminAttendanceRecord,
  AttendanceAdminNote,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AdminDashboardPage } from './admin-dashboard-page';
import { AdminDashboardService } from './admin-dashboard.service';

const record: AdminAttendanceRecord = {
  teacherId: '50000000-0000-4000-8000-000000000001',
  teacherNip: '1987001',
  teacherFullName: 'Guru Satu',
  workDate: '2026-08-25',
  status: 'LATE',
  attendanceId: '40000000-0000-4000-8000-000000000001',
  checkInAt: '2026-08-25T00:08:00.000Z',
  checkOutAt: null,
  workedMinutes: null,
  workDeficitMinutes: null,
  arrivalLateMinutes: 8,
  leaveType: null,
  notes: [],
};
const response: AdminAttendanceListResponse = {
  summary: {
    workDate: '2026-08-25',
    generatedAt: '2026-08-25T01:00:00.000Z',
    present: 1,
    late: 1,
    notPresent: 1,
    incomplete: 1,
    leave: 1,
    off: 0,
    total: 5,
  },
  data: [record],
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: 1,
    totalPages: 1,
  },
};
const note: AttendanceAdminNote = {
  id: '60000000-0000-4000-8000-000000000001',
  attendanceId: record.attendanceId!,
  note: 'Dokumen sudah diperiksa',
  createdBy: '50000000-0000-4000-8000-000000000099',
  createdByFullName: 'Admin Sekolah',
  createdAt: '2026-08-25T10:05:00.000Z',
};

const day = { workDate: '2026-08-25', state: 'WORKING' as const, description: 'Jadwal kerja Guru', provisional: true, scheduled: 5, arrived: 3, notCheckedIn: 1, leave: 1, late: 1 };
const overview: AdminDashboardResponse = {
  workDate: day.workDate, generatedAt: response.summary.generatedAt, day,
  window: { openAt: '2026-08-24T23:00:00Z', startAt: '2026-08-25T00:00:00Z', closeAt: '2026-08-25T02:00:00Z', observedUntil: '2026-08-25T01:00:00Z' },
  arrivals: [{ at: record.checkInAt!, count: 1, cumulative: 1 }],
  trend: Array.from({ length: 7 }, (_, i) => ({ ...day, workDate: `2026-08-${19 + i}` })), guards: [], rosterAvailable: false,
};

describe('AdminDashboardPage', () => {
  let fixture: ComponentFixture<AdminDashboardPage>;
  let list: ReturnType<typeof vi.fn>;
  let addNote: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let dashboard: ReturnType<typeof vi.fn>;

  async function setup(): Promise<void> {
    list = vi.fn(async () => response);
    dashboard = vi.fn(async () => overview);
    addNote = vi.fn(async () => note);
    open = vi.fn(() => ({
      afterClosed: () => of({ note: 'Dokumen sudah diperiksa' }),
    }));
    await TestBed.configureTestingModule({
      imports: [AdminDashboardPage],
      providers: [
        provideRouter([]),
        {
          provide: AdminDashboardService,
          useValue: { list, addNote, dashboard, refresh: vi.fn(async () => undefined), pendingLeaves: vi.fn(async () => ({ data: [], pagination: { totalItems: 0 } })), pendingDepartures: vi.fn(async () => ({ data: [], pagination: { totalItems: 0 } })) },
        },
      ],
    });
    TestBed.overrideProvider(MatDialog, { useValue: { open } });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(AdminDashboardPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders a matching five-status summary and paginated detail row', async () => {
    await setup();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Ritme kedatangan Guru');
    expect(text).toContain('Sudah hadir');
    expect(text).toContain('Terlambat');
    expect(text).toContain('Belum check-in tanpa izin');
    expect(text).toContain('Kehadiran 7 hari terakhir');
    expect(text).toContain('Izin');
    expect(text).toContain('Guru Satu');
    expect(text).toContain('8 menit terlambat');
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    const paginator = fixture.debugElement.injector.get(MatPaginatorIntl);
    expect(paginator.itemsPerPageLabel).toBe('Baris per halaman:');
    expect(paginator.getRangeLabel(0, 20, 5)).toBe('1–5 dari 5');
    expect(fixture.nativeElement.querySelector('.table-frame')?.tabIndex).toBe(0);
  });

  it('applies date, status, and teacher filters from the first page', async () => {
    await setup();
    const page = fixture.componentInstance;
    page.dateControl.setValue('2026-08-26');
    page.statusControl.setValue('INCOMPLETE');
    page.searchControl.setValue('Guru Satu');

    await page.applyFilters();

    expect(list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 20,
      workDate: '2026-08-26',
      status: 'INCOMPLETE',
      search: 'Guru Satu',
    });
  });

  it('loads only the requested page and page size', async () => {
    await setup();

    await fixture.componentInstance.pageChanged({
      pageIndex: 1,
      pageSize: 10,
      length: 25,
      previousPageIndex: 0,
    });

    expect(list).toHaveBeenLastCalledWith({
      page: 2,
      pageSize: 10,
      workDate: '2026-08-25',
    });
  });

  it('opens a note dialog and appends the returned note to the selected row', async () => {
    await setup();

    fixture.componentInstance.openNote(record);
    await fixture.whenStable();

    expect(open).toHaveBeenCalledTimes(1);
    expect(addNote).toHaveBeenCalledWith(record.attendanceId, {
      note: 'Dokumen sudah diperiksa',
    });
    expect(fixture.componentInstance.records()[0]?.notes).toEqual([note]);
  });

  it('prevents duplicate note submissions while one request is running', async () => {
    await setup();
    let resolveNote!: (value: AttendanceAdminNote) => void;
    addNote.mockImplementation(
      () => new Promise<AttendanceAdminNote>((resolve) => (resolveNote = resolve)),
    );
    const page = fixture.componentInstance;

    const first = page.saveNote(record, { note: 'Dokumen sudah diperiksa' });
    const repeated = page.saveNote(record, { note: 'Duplikat' });
    resolveNote(note);
    await Promise.all([first, repeated]);

    expect(addNote).toHaveBeenCalledTimes(1);
  });

  it('does not announce an empty result together with an error', async () => {
    await setup();
    fixture.componentInstance.records.set([]);
    fixture.componentInstance.errorMessage.set('Monitoring gagal dimuat.');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Monitoring gagal dimuat.');
    expect(text).not.toContain('Tidak ada data kehadiran yang sesuai filter.');
  });

  it('filters actual arrivals without changing dashboard totals and focuses results', async () => {
    await setup();
    await fixture.componentInstance.summaryFilter('arrived');
    expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, workDate: day.workDate, role: 'USER', checkedIn: 'yes' });
    expect(fixture.componentInstance.dashboard()?.day.arrived).toBe(3);
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe('attendance-title');
  });

  it('retains last good overview when refresh fails', async () => {
    await setup();
    dashboard.mockRejectedValueOnce(new Error('offline'));
    await fixture.componentInstance.loadDashboard();
    fixture.detectChanges();
    expect(fixture.componentInstance.dashboard()).toEqual(overview);
    expect(fixture.nativeElement.textContent).toContain('Data terakhir tetap ditampilkan');
  });
});
