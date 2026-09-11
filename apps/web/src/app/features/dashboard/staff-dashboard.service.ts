import type { StaffDashboardQuery, StaffDashboardResponse } from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class StaffDashboardService {
  private readonly http = inject(HttpClient);

  async fetch(input: StaffDashboardQuery): Promise<StaffDashboardResponse> {
    let params = new HttpParams().set('page', input.page).set('pageSize', input.pageSize).set('type', input.type);
    if (input.month) params = params.set('month', input.month);
    const value = await firstValueFrom(this.http.get<unknown>('/api/dashboard', { params, withCredentials: true }));
    const { StaffDashboardResponseSchema } = await import('@absensi/contracts');
    return StaffDashboardResponseSchema.parse(value);
  }

  async fetchAttachment(type: 'LEAVE' | 'EARLY_DEPARTURE', id: string): Promise<Blob> {
    const segment = type === 'LEAVE' ? 'leave-requests' : 'early-departure-requests';
    return firstValueFrom(this.http.get(`/api/${segment}/${id}/attachment`, { responseType: 'blob', withCredentials: true }));
  }

  attachmentUrl(type: 'LEAVE' | 'EARLY_DEPARTURE', id: string): string {
    const segment = type === 'LEAVE' ? 'leave-requests' : 'early-departure-requests';
    return `/api/${segment}/${id}/attachment`;
  }
}
