import type {
  AdminEarlyDepartureRequestListResponse,
  CreateEarlyDepartureRequest,
  DecideEarlyDepartureRequest,
  EarlyDepartureRequest,
  EarlyDepartureRequestListResponse,
  ListAdminEarlyDepartureRequestsQuery,
  ListEarlyDepartureRequestsQuery,
  AdminEarlyDepartureRequestDetailResponse,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../core/query/query-gateway';
import { queryKeys } from '../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class EarlyDepartureRequestsService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async listOwn(
    input: ListEarlyDepartureRequestsQuery,
  ): Promise<EarlyDepartureRequestListResponse> {
    return this.queries.get(queryKeys.earlyDepartureRequests('own', input), async () => {
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
    });
  }

  async create(input: CreateEarlyDepartureRequest, attachment?: File): Promise<EarlyDepartureRequest> {
    return this.queries.write(async () => {
    const body: CreateEarlyDepartureRequest | FormData = attachment ? this.formData(input, attachment) : input;
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/early-departure-requests', body, {
        withCredentials: true,
      }),
    );
    const { EarlyDepartureRequestResponseSchema } = await import(
      '@absensi/contracts'
    );
    return EarlyDepartureRequestResponseSchema.parse(value).earlyDepartureRequest;
    }, [queryKeys.earlyDepartureRequests('own'), queryKeys.attendance('today')]);
  }

  async getAdmin(id: string): Promise<AdminEarlyDepartureRequestDetailResponse> {
    return this.queries.get(queryKeys.earlyDepartureRequest(id), async () => {
    const value = await firstValueFrom(this.http.get<unknown>(`/api/admin/early-departure-requests/${id}`, { withCredentials: true }));
    const { AdminEarlyDepartureRequestDetailResponseSchema } = await import('@absensi/contracts');
    return AdminEarlyDepartureRequestDetailResponseSchema.parse(value);
    });
  }

  async listAdmin(
    input: ListAdminEarlyDepartureRequestsQuery,
  ): Promise<AdminEarlyDepartureRequestListResponse> {
    return this.queries.get(queryKeys.earlyDepartureRequests('admin', input), async () => {
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
    });
  }

  async decide(
    id: string,
    action: 'APPROVED' | 'REJECTED',
    input: DecideEarlyDepartureRequest = {},
  ): Promise<EarlyDepartureRequest> {
    return this.queries.write(async () => {
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
    }, [queryKeys.earlyDepartureRequests('admin'), queryKeys.earlyDepartureRequest(id), queryKeys.reports()]);
  }

  private formData(input: CreateEarlyDepartureRequest, attachment: File): FormData {
    const data = new FormData(); data.set('payload', JSON.stringify(input)); data.set('attachment', attachment); return data;
  }
}
