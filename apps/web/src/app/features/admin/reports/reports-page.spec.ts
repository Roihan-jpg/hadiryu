import type {
  MonthlyReportPreview,
  MonthlyReportReadiness,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { ReportsPage } from './reports-page';
import { ReportsService } from './reports.service';

const warning: MonthlyReportReadiness = {
  status: 'READY_WITH_WARNINGS',
  year: 2026,
  month: 9,
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  issues: [{
    code: 'SECURITY_SCHEDULE_COVERAGE_MISSING',
    source: 'SECURITY_SCHEDULE',
    missingRanges: [{ startDate: '2026-09-01', endDate: '2026-09-06' }],
  }],
};
const ready: MonthlyReportReadiness = {
  status: 'READY',
  year: 2026,
  month: 9,
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  issues: [],
};
const preview: MonthlyReportPreview = {
  year: 2026,
  month: 9,
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  generatedAt: '2026-10-01T00:00:00.000Z',
  documentStatus: 'FINAL',
  issues: [],
  teachers: [],
};

describe('ReportsPage', () => {
  let fixture: ComponentFixture<ReportsPage>;
  let readiness: ReturnType<typeof vi.fn>;
  let loadPreview: ReturnType<typeof vi.fn>;
  let exportReport: ReturnType<typeof vi.fn>;

  async function setup(
    result: MonthlyReportReadiness,
    previewResult: MonthlyReportPreview = preview,
  ): Promise<void> {
    readiness = vi.fn(async () => result);
    loadPreview = vi.fn(async () => previewResult);
    exportReport = vi.fn(async () => undefined);
    await TestBed.configureTestingModule({
      imports: [ReportsPage],
      providers: [{
        provide: ReportsService,
        useValue: {
          defaultPeriod: vi.fn(async () => ({ year: 2026, month: 9 })),
          readiness,
          preview: loadPreview,
          export: exportReport,
        },
      }, provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(ReportsPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows schedule warnings but keeps draft export available', async () => {
    const draft: MonthlyReportPreview = {
      ...preview,
      documentStatus: 'DRAFT',
      issues: [{
        category: 'CONFIGURATION',
        ...warning.issues[0]!,
      }],
    };
    await setup(warning, draft);

    const text = fixture.nativeElement.textContent as string;
    const exportButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: HTMLButtonElement) => button.textContent?.includes('Ekspor draft'));
    expect(text).toContain('Laporan dapat diekspor dengan catatan');
    expect(text).toContain('Jadwal Satpam');
    expect(text).toContain('1 September 2026–6 September 2026');
    expect(readiness).toHaveBeenCalledWith(2026, 9);
    expect(loadPreview).toHaveBeenCalledWith(2026, 9);
    expect(exportButton?.disabled).toBe(false);
  });

  it('loads the preview only after the period is ready', async () => {
    await setup(ready);

    expect(readiness).toHaveBeenCalledWith(2026, 9);
    expect(loadPreview).toHaveBeenCalledWith(2026, 9);
    expect(fixture.nativeElement.textContent).toContain('Staf tercakup');
  });

  it('groups missing dates per staff and offers direct follow-up actions', async () => {
    const issue = {
      category: 'STAFF_DATA' as const,
      code: 'NO_ATTENDANCE' as const,
      teacherId: '50000000-0000-4000-8000-000000000001',
      teacherNip: '1987001',
      teacherFullName: 'Guru Satu',
      teacherRole: 'USER' as const,
      teacherWhatsapp: '+6281234567890',
    };
    await setup(ready, {
      ...preview,
      documentStatus: 'DRAFT',
      issues: [
        { ...issue, workDate: '2026-09-01' },
        { ...issue, workDate: '2026-09-02' },
      ],
    });

    const text = fixture.nativeElement.textContent as string;
    expect(text.match(/Guru Satu/g)).toHaveLength(1);
    expect(text).toContain('1 September 2026–2 September 2026');
    expect(fixture.nativeElement.querySelector('a[href="https://wa.me/6281234567890"]')).not.toBeNull();
  });
});
