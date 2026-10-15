import type {
  CreateTeacherRequest,
  ListTeachersQuery,
  PasswordResetResult,
  Teacher,
  TeacherListResponse,
  UpdateTeacherRequest,
} from '@absensi/contracts';
import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QueryGateway } from '../../../core/query/query-gateway';
import { queryKeys } from '../../../core/query/query-keys';

@Injectable({ providedIn: 'root' })
export class TeachersService {
  async enrollmentPhoto(teacherId: string): Promise<Blob> {
    const photo = await firstValueFrom(this.http.get(`/api/admin/teachers/${teacherId}/face-photo`, {
      responseType: 'blob', withCredentials: true,
    }));
    const { FacePortraitMimeSchema } = await import('@absensi/contracts');
    FacePortraitMimeSchema.parse(photo.type);
    if (photo.size === 0 || photo.size > 262144) throw new Error('Foto pendaftaran tidak valid.');
    return photo;
  }
  async grantFaceReenrollment(teacherId:string):Promise<void> {
    const {FaceReenrollmentGrantSchema}=await import('@absensi/contracts');
    FaceReenrollmentGrantSchema.parse(await firstValueFrom(this.http.post<unknown>(
      `/api/admin/teachers/${teacherId}/face-reenrollment`,{identityReviewed:true},{withCredentials:true})));
  }
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryGateway);

  async list(input: ListTeachersQuery): Promise<TeacherListResponse> {
    return this.queries.get(queryKeys.teachers(input), async () => {
    let params = new HttpParams();
    if (input.search) params = params.set('search', input.search);
    if (input.role) params = params.set('role', input.role);
    if (input.isActive !== undefined) params = params.set('isActive', String(input.isActive));
    if (input.mustChangePassword !== undefined) params = params.set('mustChangePassword', String(input.mustChangePassword));
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
    });
  }

  async create(input: CreateTeacherRequest): Promise<Teacher> {
    return this.queries.write(async () => this.parseTeacherResponse(
      await firstValueFrom(
        this.http.post<unknown>('/api/admin/teachers', input, {
          withCredentials: true,
        }),
      ),
    ), [queryKeys.teachers()]);
  }

  async update(teacherId: string, input: UpdateTeacherRequest): Promise<Teacher> {
    return this.queries.write(async () => this.parseTeacherResponse(
      await firstValueFrom(
        this.http.patch<unknown>(`/api/admin/teachers/${teacherId}`, input, {
          withCredentials: true,
        }),
      ),
    ), [queryKeys.teachers()]);
  }

  async setActive(teacherId: string, isActive: boolean): Promise<Teacher> {
    return this.queries.write(async () => this.parseTeacherResponse(
      await firstValueFrom(
        this.http.post<unknown>(
          `/api/admin/teachers/${teacherId}/${isActive ? 'activate' : 'deactivate'}`,
          {},
          { withCredentials: true },
        ),
      ),
    ), [queryKeys.teachers(), queryKeys.auth]);
  }

  async resetPassword(
    teacherId: string,
  ): Promise<PasswordResetResult> {
    return this.queries.write(async () => {
    const value = await firstValueFrom(
        this.http.post<unknown>(
          `/api/admin/teachers/${teacherId}/reset-password`,
          {},
          { withCredentials: true },
        ),
      );
    const { PasswordResetResponseSchema } = await import('@absensi/contracts');
    return PasswordResetResponseSchema.parse(value);
    }, [queryKeys.teachers()]);
  }

  private async parseTeacherResponse(value: unknown): Promise<Teacher> {
    const { TeacherResponseSchema } = await import('@absensi/contracts');
    return TeacherResponseSchema.parse(value).teacher;
  }
}
