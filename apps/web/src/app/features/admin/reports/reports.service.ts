import type {
  DefaultReportPeriod,
  MonthlyReportPreview,
  MonthlyReportReadiness,
} from '@absensi/contracts';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../../core/query/query-gateway';
import { queryKeys } from '../../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async defaultPeriod(): Promise<DefaultReportPeriod> {
    return this.queries.get(queryKeys.reports('default-period'), async () => {
    const value = await firstValueFrom(this.http.get<unknown>('/api/admin/reports/default-period', { withCredentials: true }));
    const { DefaultReportPeriodSchema } = await import('@absensi/contracts');
    return DefaultReportPeriodSchema.parse(value);
    });
  }

  async preview(year: number, month: number): Promise<MonthlyReportPreview> {
    return this.queries.get(queryKeys.reports(`${year}-${month}-preview`), async () => {
    const value = await firstValueFrom(this.http.get<unknown>(`/api/admin/reports/monthly/${year}/${month}/preview`, { withCredentials: true }));
    const { MonthlyReportPreviewSchema } = await import('@absensi/contracts');
    return MonthlyReportPreviewSchema.parse(value);
    });
  }

  async readiness(year: number, month: number): Promise<MonthlyReportReadiness> {
    return this.queries.get(queryKeys.reports(`${year}-${month}-readiness`), async () => {
      const value = await firstValueFrom(this.http.get<unknown>(
        `/api/admin/reports/monthly/${year}/${month}/readiness`,
        { withCredentials: true },
      ));
      const { MonthlyReportReadinessSchema } = await import('@absensi/contracts');
      return MonthlyReportReadinessSchema.parse(value);
    });
  }

  async export(year: number, month: number): Promise<void> {
    const response = await firstValueFrom(this.http.post(`/api/admin/reports/monthly/${year}/${month}/export`, {}, {
      observe: 'response', responseType: 'blob', withCredentials: true,
    }));
    const url = URL.createObjectURL(response.body ?? new Blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `laporan-absensi-${year}-${String(month).padStart(2, '0')}.xlsx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
