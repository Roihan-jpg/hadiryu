import type {
  AdminAttendanceListResponse,
  AttendanceAdminNote,
  CreateAttendanceAdminNote,
  ListAdminAttendanceQuery,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../../core/query/query-gateway';
import { queryKeys } from '../../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class AdminDashboardService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async dashboard(workDate?: string) {
    return this.queries.get(['admin', 'dashboard', workDate ?? 'today'], async () => {
      const { AdminDashboardResponseSchema } = await import('@absensi/contracts');
      const params = workDate ? new HttpParams().set('workDate', workDate) : new HttpParams();
      return AdminDashboardResponseSchema.parse(await firstValueFrom(this.http.get<unknown>('/api/admin/dashboard', { params, withCredentials: true })));
    }, 0);
  }

  async pendingLeaves() {
    return this.queries.get(['admin', 'dashboard', 'leaves'], async () => {
      const { AdminLeaveRequestListResponseSchema } = await import('@absensi/contracts');
      return AdminLeaveRequestListResponseSchema.parse(await firstValueFrom(this.http.get<unknown>('/api/admin/leave-requests', { params: { page: 1, pageSize: 3, status: 'PENDING', sort: 'oldest' }, withCredentials: true })));
    }, 0);
  }

  async pendingDepartures() {
    return this.queries.get(['admin', 'dashboard', 'departures'], async () => {
      const { AdminEarlyDepartureRequestListResponseSchema } = await import('@absensi/contracts');
      return AdminEarlyDepartureRequestListResponseSchema.parse(await firstValueFrom(this.http.get<unknown>('/api/admin/early-departure-requests', { params: { page: 1, pageSize: 3, status: 'PENDING' }, withCredentials: true })));
    }, 0);
  }

  async refresh() {
    await this.queries.write(async () => undefined, [['admin', 'dashboard'], queryKeys.monitoring()]);
  }

  async list(
    input: ListAdminAttendanceQuery,
  ): Promise<AdminAttendanceListResponse> {
    return this.queries.get(queryKeys.monitoring(input), () => this.fetchList(input));
  }

  async fetchList(
    input: ListAdminAttendanceQuery,
  ): Promise<AdminAttendanceListResponse> {
    let params = new HttpParams()
      .set('page', input.page)
      .set('pageSize', input.pageSize);
    if (input.workDate) params = params.set('workDate', input.workDate);
    if (input.status) params = params.set('status', input.status);
    if (input.role) params = params.set('role', input.role);
    if (input.checkedIn) params = params.set('checkedIn', input.checkedIn);
    if (input.lateOnly) params = params.set('lateOnly', input.lateOnly);
    if (input.search) params = params.set('search', input.search);
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/attendance', {
        params,
        withCredentials: true,
      }),
    );
    const { AdminAttendanceListResponseSchema } = await import(
      '@absensi/contracts'
    );
    return AdminAttendanceListResponseSchema.parse(value);
  }

  async addNote(
    attendanceId: string,
    input: CreateAttendanceAdminNote,
  ): Promise<AttendanceAdminNote> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>(
        `/api/admin/attendance/${attendanceId}/notes`,
        input,
        { withCredentials: true },
      ),
    );
    const { AttendanceAdminNoteResponseSchema } = await import(
      '@absensi/contracts'
    );
    return AttendanceAdminNoteResponseSchema.parse(value).note;
    }, [queryKeys.monitoring()]);
  }
}
