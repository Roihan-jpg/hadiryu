import type { MonthlyReportReadiness } from '@absensi/contracts';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReportsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and validates readiness before report preview', async () => {
    const response: MonthlyReportReadiness = {
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
    const resultPromise = service.readiness(2026, 9);
    const request = http.expectOne(
      '/api/admin/reports/monthly/2026/9/readiness',
    );

    expect(request.request.method).toBe('GET');
    expect(request.request.withCredentials).toBe(true);
    request.flush(response);

    await expect(resultPromise).resolves.toEqual(response);
  });

  it('uses the server-provided DRAFT filename for downloads', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const resultPromise = service.export(2026, 9);
    const request = http.expectOne('/api/admin/reports/monthly/2026/9/export');
    expect(request.request.method).toBe('POST');
    request.flush(new Blob(['xlsx']), {
      headers: {
        'Content-Disposition': 'attachment; filename="laporan-absensi-DRAFT-2026-09.xlsx"',
      },
    });

    await resultPromise;
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      'laporan-absensi-DRAFT-2026-09.xlsx',
    );
    click.mockRestore();
  });
});
