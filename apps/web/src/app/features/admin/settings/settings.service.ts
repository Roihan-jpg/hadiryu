import type {
  CalendarException,
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  SaveGeofenceSettingsRequest,
  SaveScheduleSettingsRequest,
  ScheduleSettingsResponse,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  async getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse> {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/schedules', {
        params: new HttpParams().set('effectiveOn', effectiveOn),
        withCredentials: true,
      }),
    );
    const { ScheduleSettingsResponseSchema } = await import('@absensi/contracts');
    return ScheduleSettingsResponseSchema.parse(value);
  }

  async saveSchedules(
    input: SaveScheduleSettingsRequest,
  ): Promise<ScheduleSettingsResponse> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/schedules', input, {
        withCredentials: true,
      }),
    );
    const { ScheduleSettingsResponseSchema } = await import('@absensi/contracts');
    return ScheduleSettingsResponseSchema.parse(value);
  }

  async getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse> {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/geofence', {
        params: new HttpParams().set('effectiveOn', effectiveOn),
        withCredentials: true,
      }),
    );
    const { GeofenceSettingsResponseSchema } = await import('@absensi/contracts');
    return GeofenceSettingsResponseSchema.parse(value);
  }

  async saveGeofence(
    input: SaveGeofenceSettingsRequest,
  ): Promise<GeofenceSettingsResponse> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/geofence', input, {
        withCredentials: true,
      }),
    );
    const { GeofenceSettingsResponseSchema } = await import('@absensi/contracts');
    return GeofenceSettingsResponseSchema.parse(value);
  }

  async getCalendarExceptions(): Promise<CalendarExceptionsResponse> {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/calendar', { withCredentials: true }),
    );
    const { CalendarExceptionsResponseSchema } = await import('@absensi/contracts');
    return CalendarExceptionsResponseSchema.parse(value);
  }

  async createCalendarException(
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/calendar', input, {
        withCredentials: true,
      }),
    );
    const { CalendarExceptionSchema } = await import('@absensi/contracts');
    return CalendarExceptionSchema.parse(value);
  }

  async updateCalendarException(
    id: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    const value = await firstValueFrom(
      this.http.patch<unknown>(`/api/admin/settings/calendar/${id}`, input, {
        withCredentials: true,
      }),
    );
    const { CalendarExceptionSchema } = await import('@absensi/contracts');
    return CalendarExceptionSchema.parse(value);
  }

  async deleteCalendarException(id: string): Promise<void> {
    await firstValueFrom(
      this.http.delete(`/api/admin/settings/calendar/${id}`, { withCredentials: true }),
    );
  }

}
