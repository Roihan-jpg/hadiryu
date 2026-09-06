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
import { QueryGateway } from '../../core/query/query-gateway';
import { queryKeys } from '../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async getToday(): Promise<TodayAttendanceResponse> {
    return this.queries.get(queryKeys.attendance('today'), () => this.fetchToday());
  }

  async fetchToday(): Promise<TodayAttendanceResponse> {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/attendance/today', {
        withCredentials: true,
      }),
    );
    const { TodayAttendanceResponseSchema } = await import('@absensi/contracts');
    return TodayAttendanceResponseSchema.parse(value);
  }

  async checkIn(location: LocationInput): Promise<CheckInRecord> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/attendance/check-in', location, {
        withCredentials: true,
      }),
    );
    const { CheckInRecordSchema } = await import('@absensi/contracts');
    return CheckInRecordSchema.parse(value);
    }, [queryKeys.attendance('today'), queryKeys.attendance('history')]);
  }

  async checkout(location: LocationInput): Promise<CompletedAttendanceRecord> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/attendance/checkout', location, {
        withCredentials: true,
      }),
    );
    const { CompletedAttendanceRecordSchema } = await import(
      '@absensi/contracts'
    );
    return CompletedAttendanceRecordSchema.parse(value);
    }, [queryKeys.attendance('today'), queryKeys.attendance('history')]);
  }

  async getHistory(
    query: ListAttendanceHistoryQuery,
  ): Promise<AttendanceHistoryResponse> {
    return this.queries.get(
      queryKeys.attendance('history', query),
      () => this.fetchHistory(query),
    );
  }

  async fetchHistory(
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
