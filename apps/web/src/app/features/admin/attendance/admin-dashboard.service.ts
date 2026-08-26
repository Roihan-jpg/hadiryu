import type {
  AdminAttendanceListResponse,
  AttendanceAdminNote,
  CreateAttendanceAdminNote,
  ListAdminAttendanceQuery,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AdminDashboardService {
  private readonly http = inject(HttpClient);

  async list(
    input: ListAdminAttendanceQuery,
  ): Promise<AdminAttendanceListResponse> {
    let params = new HttpParams()
      .set('page', input.page)
      .set('pageSize', input.pageSize);
    if (input.workDate) params = params.set('workDate', input.workDate);
    if (input.status) params = params.set('status', input.status);
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
  }
}
