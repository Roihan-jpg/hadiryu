import type { RequestQuotaResponse } from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class RequestQuotasService {
  private readonly http = inject(HttpClient);

  async fetch(month: string): Promise<RequestQuotaResponse> {
    const value = await firstValueFrom(this.http.get<unknown>('/api/request-quotas', {
      params: new HttpParams().set('month', month),
      withCredentials: true,
    }));
    const { RequestQuotaResponseSchema } = await import('@absensi/contracts');
    return RequestQuotaResponseSchema.parse(value);
  }
}
