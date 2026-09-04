import type {
  AuthResponse,
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
} from '@absensi/contracts';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { queryKeys } from '../query/query-keys';
import { appQueryClient } from '../query/query-client';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly queryClient = appQueryClient;
  private readonly currentUser = signal<AuthUser | null>(null);
  private initialized = false;

  readonly user = this.currentUser.asReadonly();

  async login(input: LoginRequest): Promise<AuthUser> {
    const response = await this.parseAuthResponse(
      await firstValueFrom(
        this.http.post<unknown>('/api/auth/login', input, {
          withCredentials: true,
        }),
      ),
    );
    this.setUser(response.user);
    return response.user;
  }

  async ensureSession(): Promise<AuthUser | null> {
    if (this.initialized) return this.currentUser();

    try {
      const response = await this.queryClient.fetchQuery({
        queryKey: queryKeys.auth,
        queryFn: async () => this.parseAuthResponse(await firstValueFrom(
          this.http.get<unknown>('/api/auth/me', { withCredentials: true }),
        )),
      });
      this.setUser(response.user);
      return response.user;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.clearUser();
        return null;
      }
      this.clearUser();
      return null;
    }
  }

  async changePassword(input: ChangePasswordRequest): Promise<AuthUser> {
    const response = await this.parseAuthResponse(
      await firstValueFrom(
        this.http.post<unknown>('/api/auth/change-password', input, {
          withCredentials: true,
        }),
      ),
    );
    this.setUser(response.user);
    return response.user;
  }

  async logout(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.post<unknown>(
          '/api/auth/logout',
          {},
          { withCredentials: true },
        ),
      );
      const { LogoutResponseSchema } = await import('@absensi/contracts');
      LogoutResponseSchema.parse(response);
    } finally {
      this.clearUser();
    }
  }

  clearUser(): void {
    this.currentUser.set(null);
    this.initialized = true;
    this.queryClient.clear();
  }

  acceptUser(user: AuthUser): void {
    this.setUser(user);
  }

  private setUser(user: AuthUser): void {
    this.currentUser.set(user);
    this.initialized = true;
    this.queryClient.setQueryData(queryKeys.auth, { user });
  }

  private async parseAuthResponse(value: unknown): Promise<AuthResponse> {
    const { AuthResponseSchema } = await import('@absensi/contracts');
    return AuthResponseSchema.parse(value);
  }
}
