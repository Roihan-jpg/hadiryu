import type {
  CalendarException,
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  GeofenceTemplate,
  GeofenceTemplateInput,
  GeofenceTemplatesResponse,
  SaveScheduleSettingsRequest,
  SaveSecurityScheduleSettingsRequest,
  SecurityScheduleSettingsResponse,
  ScheduleSettingsResponse,
  ReportingSettingsResponse,
  SaveReportingSettingsRequest,
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

  async getReportingSettings(): Promise<ReportingSettingsResponse> {
    return this.queries.get(queryKeys.settings('reporting'), async () => {
      const value = await firstValueFrom(this.http.get<unknown>(
        '/api/admin/settings/reporting',
        { withCredentials: true },
      ));
      const { ReportingSettingsResponseSchema } = await import('@absensi/contracts');
      return ReportingSettingsResponseSchema.parse(value);
    });
  }

  async saveReportingSettings(
    input: SaveReportingSettingsRequest,
  ): Promise<ReportingSettingsResponse> {
    return this.queries.write(async () => {
      const value = await firstValueFrom(this.http.post<unknown>(
        '/api/admin/settings/reporting',
        input,
        { withCredentials: true },
      ));
      const { ReportingSettingsResponseSchema } = await import('@absensi/contracts');
      return ReportingSettingsResponseSchema.parse(value);
    }, [queryKeys.settings()]);
  }

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

  async getGeofenceTemplates(): Promise<GeofenceTemplatesResponse> {
    return this.queries.get(queryKeys.settings('geofence-templates'), async () => {
      const value = await firstValueFrom(this.http.get<unknown>('/api/admin/settings/geofence-templates', { withCredentials: true }));
      const { GeofenceTemplatesResponseSchema } = await import('@absensi/contracts');
      return GeofenceTemplatesResponseSchema.parse(value);
    });
  }

  async createGeofenceTemplate(input: GeofenceTemplateInput): Promise<GeofenceTemplate> {
    return this.queries.write(async () => {
      const value = await firstValueFrom(this.http.post<unknown>('/api/admin/settings/geofence-templates', input, { withCredentials: true }));
      const { GeofenceTemplateSchema } = await import('@absensi/contracts');
      return GeofenceTemplateSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async updateGeofenceTemplate(id: string, input: GeofenceTemplateInput): Promise<GeofenceTemplate> {
    return this.queries.write(async () => {
      const value = await firstValueFrom(this.http.patch<unknown>(`/api/admin/settings/geofence-templates/${id}`, input, { withCredentials: true }));
      const { GeofenceTemplateSchema } = await import('@absensi/contracts');
      return GeofenceTemplateSchema.parse(value);
    }, [queryKeys.settings()]);
  }

  async deleteGeofenceTemplate(id: string): Promise<void> {
    await this.queries.write(async () => { await firstValueFrom(this.http.delete(`/api/admin/settings/geofence-templates/${id}`, { withCredentials: true })); }, [queryKeys.settings()]);
  }

  async activateGeofenceTemplate(templateId: string): Promise<GeofenceSettingsResponse> {
    return this.queries.write(async () => {
      const value = await firstValueFrom(this.http.post<unknown>('/api/admin/settings/geofence/activate', { templateId }, { withCredentials: true }));
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
