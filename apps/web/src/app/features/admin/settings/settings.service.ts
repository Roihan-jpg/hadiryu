import type {
  CalendarException,
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  SaveGeofenceSettingsRequest,
  SaveScheduleSettingsRequest,
  SaveSecurityScheduleSettingsRequest,
  SecurityScheduleSettingsResponse,
  ScheduleSettingsResponse,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../../core/query/query-gateway';
import { queryKeys } from '../../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async getSchedules(effectiveOn: string): Promise<ScheduleSettingsResponse> {
    return this.queries.get(queryKeys.settings(`schedules:${effectiveOn}`), async () => {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/schedules', {
        params: new HttpParams().set('effectiveOn', effectiveOn),
        withCredentials: true,
      }),
    );
    const { ScheduleSettingsResponseSchema } = await import('@absensi/contracts');
    return ScheduleSettingsResponseSchema.parse(value);
    });
  }

  async saveSchedules(
    input: SaveScheduleSettingsRequest,
  ): Promise<ScheduleSettingsResponse> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/schedules', input, {
        withCredentials: true,
      }),
    );
    const { ScheduleSettingsResponseSchema } = await import('@absensi/contracts');
    return ScheduleSettingsResponseSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async getSecuritySchedules(effectiveOn: string): Promise<SecurityScheduleSettingsResponse> {
    return this.queries.get(queryKeys.settings(`security-schedules:${effectiveOn}`), async () => {
      const value = await firstValueFrom(this.http.get<unknown>('/api/admin/settings/security-schedules', {
        params: new HttpParams().set('effectiveOn', effectiveOn), withCredentials: true,
      }));
      const { SecurityScheduleSettingsResponseSchema } = await import('@absensi/contracts');
      return SecurityScheduleSettingsResponseSchema.parse(value);
    });
  }

  async saveSecuritySchedules(input: SaveSecurityScheduleSettingsRequest): Promise<SecurityScheduleSettingsResponse> {
    return this.queries.write(async () => {
      const value = await firstValueFrom(this.http.post<unknown>('/api/admin/settings/security-schedules', input, { withCredentials: true }));
      const { SecurityScheduleSettingsResponseSchema } = await import('@absensi/contracts');
      return SecurityScheduleSettingsResponseSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async getGeofence(effectiveOn: string): Promise<GeofenceSettingsResponse> {
    return this.queries.get(queryKeys.settings(`geofence:${effectiveOn}`), async () => {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/geofence', {
        params: new HttpParams().set('effectiveOn', effectiveOn),
        withCredentials: true,
      }),
    );
    const { GeofenceSettingsResponseSchema } = await import('@absensi/contracts');
    return GeofenceSettingsResponseSchema.parse(value);
    });
  }

  async saveGeofence(
    input: SaveGeofenceSettingsRequest,
  ): Promise<GeofenceSettingsResponse> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/geofence', input, {
        withCredentials: true,
      }),
    );
    const { GeofenceSettingsResponseSchema } = await import('@absensi/contracts');
    return GeofenceSettingsResponseSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async getCalendarExceptions(): Promise<CalendarExceptionsResponse> {
    return this.queries.get(queryKeys.settings('calendar'), async () => {
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/settings/calendar', { withCredentials: true }),
    );
    const { CalendarExceptionsResponseSchema } = await import('@absensi/contracts');
    return CalendarExceptionsResponseSchema.parse(value);
    });
  }

  async createCalendarException(
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.post<unknown>('/api/admin/settings/calendar', input, {
        withCredentials: true,
      }),
    );
    const { CalendarExceptionSchema } = await import('@absensi/contracts');
    return CalendarExceptionSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async updateCalendarException(
    id: string,
    input: CalendarExceptionInput,
  ): Promise<CalendarException> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
      this.http.patch<unknown>(`/api/admin/settings/calendar/${id}`, input, {
        withCredentials: true,
      }),
    );
    const { CalendarExceptionSchema } = await import('@absensi/contracts');
    return CalendarExceptionSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async deleteCalendarException(id: string): Promise<void> {
    await this.queries.write(() => firstValueFrom(
      this.http.delete(`/api/admin/settings/calendar/${id}`, { withCredentials: true }),
    ), [queryKeys.settings()]);
  }

}
