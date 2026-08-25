import type {
  AttendanceHistoryResponse,
  CheckInRecord,
  CompletedAttendanceRecord,
  ListAttendanceHistoryQuery,
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);

  async getToday(): Promise<TodayAttendanceResponse> {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/attendance/today', {
        withCredentials: true,
      }),
    );
    const { TodayAttendanceResponseSchema } = await import('@absensi/contracts');
    return TodayAttendanceResponseSchema.parse(value);
  }

  async checkIn(location: LocationInput): Promise<CheckInRecord> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/attendance/check-in', location, {
        withCredentials: true,
      }),
    );
    const { CheckInRecordSchema } = await import('@absensi/contracts');
    return CheckInRecordSchema.parse(value);
  }

  async checkout(location: LocationInput): Promise<CompletedAttendanceRecord> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/attendance/checkout', location, {
        withCredentials: true,
      }),
    );
    const { CompletedAttendanceRecordSchema } = await import(
      '@absensi/contracts'
    );
    return CompletedAttendanceRecordSchema.parse(value);
  }

  async getHistory(
    query: ListAttendanceHistoryQuery,
  ): Promise<AttendanceHistoryResponse> {
    let params = new HttpParams()
      .set('page', query.page)
      .set('pageSize', query.pageSize);
    if (query.month) params = params.set('month', query.month);
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/attendance/history', {
        params,
        withCredentials: true,
      }),
    );
    const { AttendanceHistoryResponseSchema } = await import(
      '@absensi/contracts'
    );
    return AttendanceHistoryResponseSchema.parse(value);
  }
}
