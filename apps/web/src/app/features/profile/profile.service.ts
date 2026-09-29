import type { AuthUser, UpdateOwnProfileRequest } from '@absensi/contracts';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);

  async updateProfile(input: UpdateOwnProfileRequest): Promise<AuthUser> {
    const response = await firstValueFrom(this.http.patch<{ profile: AuthUser }>(
      '/api/profile', input, { withCredentials: true },
    ));
    return response.profile;
  }

  async uploadPhoto(file: File): Promise<AuthUser> {
    const body = new FormData();
    body.append('photo', file);
    const response = await firstValueFrom(this.http.post<{ profile: AuthUser }>(
      '/api/profile/photo', body, { withCredentials: true },
    ));
    return response.profile;
  }

  async deletePhoto(): Promise<AuthUser> {
    const response = await firstValueFrom(this.http.delete<{ profile: AuthUser }>(
      '/api/profile/photo', { withCredentials: true },
    ));
    return response.profile;
  }
}
