import type {
  AdminLeaveRequestListResponse,
  DecideLeaveRequest,
  LeaveRequest,
  LeaveRequestListResponse,
  ListAdminLeaveRequestsQuery,
  ListLeaveRequestsQuery,
  CreateLeaveRequest,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LeaveRequestsService {
  private readonly http = inject(HttpClient);

  async listOwn(input: ListLeaveRequestsQuery): Promise<LeaveRequestListResponse> {
    let params = new HttpParams().set('page', input.page).set('pageSize', input.pageSize);
    if (input.status) params = params.set('status', input.status);
    const value = await firstValueFrom(this.http.get<unknown>('/api/leave-requests', { params, withCredentials: true }));
    const { LeaveRequestListResponseSchema } = await import('@absensi/contracts');
    return LeaveRequestListResponseSchema.parse(value);
  }

  async create(input: CreateLeaveRequest): Promise<LeaveRequest> {
    const value = await firstValueFrom(this.http.post<unknown>('/api/leave-requests', input, { withCredentials: true }));
    const { LeaveRequestResponseSchema } = await import('@absensi/contracts');
    return LeaveRequestResponseSchema.parse(value).leaveRequest;
  }

  async cancel(id: string): Promise<LeaveRequest> {
    const value = await firstValueFrom(this.http.post<unknown>(`/api/leave-requests/${id}/cancel`, {}, { withCredentials: true }));
    const { LeaveRequestResponseSchema } = await import('@absensi/contracts');
    return LeaveRequestResponseSchema.parse(value).leaveRequest;
  }

  async listAdmin(input: ListAdminLeaveRequestsQuery): Promise<AdminLeaveRequestListResponse> {
    let params = new HttpParams().set('page', input.page).set('pageSize', input.pageSize);
    if (input.status) params = params.set('status', input.status);
    if (input.leaveDate) params = params.set('leaveDate', input.leaveDate);
    if (input.search) params = params.set('search', input.search);
    const value = await firstValueFrom(this.http.get<unknown>('/api/admin/leave-requests', { params, withCredentials: true }));
    const { AdminLeaveRequestListResponseSchema } = await import('@absensi/contracts');
    return AdminLeaveRequestListResponseSchema.parse(value);
  }

  async decide(id: string, action: 'APPROVED' | 'REJECTED', input?: DecideLeaveRequest): Promise<LeaveRequest> {
    const endpoint = action === 'APPROVED' ? 'approve' : 'reject';
    const value = await firstValueFrom(this.http.post<unknown>(`/api/admin/leave-requests/${id}/${endpoint}`, input ?? {}, { withCredentials: true }));
    const { LeaveRequestResponseSchema } = await import('@absensi/contracts');
    return LeaveRequestResponseSchema.parse(value).leaveRequest;
  }
}
