import type { AuditLogListResponse, ListAuditLogsQuery } from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../../core/query/query-gateway';
import { queryKeys } from '../../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);
  async list(input: ListAuditLogsQuery): Promise<AuditLogListResponse> {
    return this.queries.get(queryKeys.audit(input), async () => {
    let params = new HttpParams().set('page', input.page).set('pageSize', input.pageSize);
    if (input.fromDate) params = params.set('fromDate', input.fromDate);
    if (input.toDate) params = params.set('toDate', input.toDate);
    if (input.actorId) params = params.set('actorId', input.actorId);
    if (input.action) params = params.set('action', input.action);
    if (input.entityType) params = params.set('entityType', input.entityType);
    const value = await firstValueFrom(this.http.get<unknown>('/api/admin/audit-logs', { params, withCredentials: true }));
    const { AuditLogListResponseSchema } = await import('@absensi/contracts');
    return AuditLogListResponseSchema.parse(value);
    });
  }
}
