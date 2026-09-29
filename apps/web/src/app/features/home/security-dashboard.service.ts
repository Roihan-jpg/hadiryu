import { SecurityGuardDashboardResponseSchema, type SecurityGuardDashboardResponse } from '@absensi/contracts';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SecurityDashboardService {
  private readonly http = inject(HttpClient);

  async getDashboard(): Promise<SecurityGuardDashboardResponse> {
    const value = await firstValueFrom(this.http.get<unknown>(
      '/api/security-guard/dashboard',
      { withCredentials: true },
    ));
    return SecurityGuardDashboardResponseSchema.parse(value);
  }
}
