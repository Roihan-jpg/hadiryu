import type {
  CheckInRecord,
  LocationInput,
  TodayAttendanceResponse,
} from '@absensi/contracts';
import { HttpClient } from '@angular/common/http';
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
}
