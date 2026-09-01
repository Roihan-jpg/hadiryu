import type {
  AdminEarlyDepartureRequestListResponse,
  CreateEarlyDepartureRequest,
  DecideEarlyDepartureRequest,
  EarlyDepartureRequest,
  EarlyDepartureRequestListResponse,
  ListAdminEarlyDepartureRequestsQuery,
  ListEarlyDepartureRequestsQuery,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class EarlyDepartureRequestsService {
  private readonly http = inject(HttpClient);

  async listOwn(
    input: ListEarlyDepartureRequestsQuery,
  ): Promise<EarlyDepartureRequestListResponse> {
    let params = new HttpParams()
      .set('page', input.page)
      .set('pageSize', input.pageSize);
    if (input.status) params = params.set('status', input.status);
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/early-departure-requests', {
        params,
        withCredentials: true,
      }),
    );
    const { EarlyDepartureRequestListResponseSchema } = await import(
      '@absensi/contracts'
    );
    return EarlyDepartureRequestListResponseSchema.parse(value);
  }

  async create(input: CreateEarlyDepartureRequest): Promise<EarlyDepartureRequest> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/early-departure-requests', input, {
        withCredentials: true,
      }),
    );
    const { EarlyDepartureRequestResponseSchema } = await import(
      '@absensi/contracts'
    );
    return EarlyDepartureRequestResponseSchema.parse(value).earlyDepartureRequest;
  }

  async listAdmin(
    input: ListAdminEarlyDepartureRequestsQuery,
  ): Promise<AdminEarlyDepartureRequestListResponse> {
    let params = new HttpParams()
      .set('page', input.page)
      .set('pageSize', input.pageSize);
    if (input.status) params = params.set('status', input.status);
    if (input.workDate) params = params.set('workDate', input.workDate);
    if (input.search) params = params.set('search', input.search);
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/early-departure-requests', {
        params,
        withCredentials: true,
      }),
    );
    const { AdminEarlyDepartureRequestListResponseSchema } = await import(
      '@absensi/contracts'
    );
    return AdminEarlyDepartureRequestListResponseSchema.parse(value);
  }

  async decide(
    id: string,
    action: 'APPROVED' | 'REJECTED',
    input: DecideEarlyDepartureRequest = {},
  ): Promise<EarlyDepartureRequest> {
    const endpoint = action === 'APPROVED' ? 'approve' : 'reject';
    const value = await firstValueFrom(
      this.http.post<unknown>(
        `/api/admin/early-departure-requests/${id}/${endpoint}`,
        input,
        { withCredentials: true },
      ),
    );
    const { EarlyDepartureRequestResponseSchema } = await import(
      '@absensi/contracts'
    );
    return EarlyDepartureRequestResponseSchema.parse(value).earlyDepartureRequest;
  }
}
