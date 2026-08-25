import type {
  CreateGeofenceVersionRequest,
  CreateScheduleVersionRequest,
  GeofenceSettingsResponse,
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

  async createSchedules(
    input: CreateScheduleVersionRequest,
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

  async createGeofence(
    input: CreateGeofenceVersionRequest,
  ): Promise<GeofenceSettingsResponse> {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/geofence', input, {
        withCredentials: true,
      }),
    );
    const { GeofenceSettingsResponseSchema } = await import('@absensi/contracts');
    return GeofenceSettingsResponseSchema.parse(value);
  }
}
