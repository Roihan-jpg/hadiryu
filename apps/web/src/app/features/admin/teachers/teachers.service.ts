import type {
  CreateTeacherRequest,
  ListTeachersQuery,
  ResetTeacherPasswordRequest,
  Teacher,
  TeacherListResponse,
  UpdateTeacherRequest,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TeachersService {
  private readonly http = inject(HttpClient);

  async list(input: ListTeachersQuery): Promise<TeacherListResponse> {
    let params = new HttpParams();
    if (input.search) params = params.set('search', input.search);
    params = params
      .set('page', input.page.toString())
      .set('pageSize', input.pageSize.toString());
    const value = await firstValueFrom(
      this.http.get<unknown>('/api/admin/teachers', {
        params,
        withCredentials: true,
      }),
    );
    const { TeacherListResponseSchema } = await import('@absensi/contracts');
    return TeacherListResponseSchema.parse(value);
  }

  async create(input: CreateTeacherRequest): Promise<Teacher> {
    return this.parseTeacherResponse(
      await firstValueFrom(
        this.http.post<unknown>('/api/admin/teachers', input, {
          withCredentials: true,
        }),
      ),
    );
  }

  async update(teacherId: string, input: UpdateTeacherRequest): Promise<Teacher> {
    return this.parseTeacherResponse(
      await firstValueFrom(
        this.http.patch<unknown>(`/api/admin/teachers/${teacherId}`, input, {
          withCredentials: true,
        }),
      ),
    );
  }

  async setActive(teacherId: string, isActive: boolean): Promise<Teacher> {
    return this.parseTeacherResponse(
      await firstValueFrom(
        this.http.post<unknown>(
          `/api/admin/teachers/${teacherId}/${isActive ? 'activate' : 'deactivate'}`,
          {},
          { withCredentials: true },
        ),
      ),
    );
  }

  async resetPassword(
    teacherId: string,
    input: ResetTeacherPasswordRequest,
  ): Promise<Teacher> {
    return this.parseTeacherResponse(
      await firstValueFrom(
        this.http.post<unknown>(
          `/api/admin/teachers/${teacherId}/reset-password`,
          input,
          { withCredentials: true },
        ),
      ),
    );
  }

  private async parseTeacherResponse(value: unknown): Promise<Teacher> {
    const { TeacherResponseSchema } = await import('@absensi/contracts');
    return TeacherResponseSchema.parse(value).teacher;
  }
}
