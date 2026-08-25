import {
  CreateTeacherRequestSchema,
  ListTeachersQuerySchema,
  ResetTeacherPasswordRequestSchema,
  TeacherListResponseSchema,
  UpdateTeacherRequestSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('teacher contracts', () => {
  it('normalizes pagination and an optional search term', () => {
    expect(
      ListTeachersQuerySchema.parse({
        page: '2',
        pageSize: '25',
        search: '  Siti  ',
      }),
    ).toEqual({ page: 2, pageSize: 25, search: 'Siti' });
  });

  it('rejects page sizes outside the supported range', () => {
    expect(
      ListTeachersQuerySchema.safeParse({ page: '1', pageSize: '101' }).success,
    ).toBe(false);
  });

  it('only accepts profile fields and an initial password when creating a teacher', () => {
    const result = CreateTeacherRequestSchema.safeParse({
      nip: '19870001',
      fullName: 'Guru Baru',
      initialPassword: 'Sementara-123',
      role: 'SUPER_ADMIN',
    });

    expect(result.success).toBe(false);
  });

  it('requires at least one editable profile field and never accepts role or status', () => {
    expect(UpdateTeacherRequestSchema.safeParse({}).success).toBe(false);
    expect(
      UpdateTeacherRequestSchema.safeParse({ isActive: true }).success,
    ).toBe(false);
    expect(
      UpdateTeacherRequestSchema.parse({ fullName: '  Nama Baru  ' }),
    ).toEqual({ fullName: 'Nama Baru' });
  });

  it('validates a temporary password without exposing it in teacher responses', () => {
    expect(
      ResetTeacherPasswordRequestSchema.safeParse({
        temporaryPassword: 'pendek',
      }).success,
    ).toBe(false);

    const response = TeacherListResponseSchema.parse({
      data: [
        {
          id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
          nip: '19870001',
          fullName: 'Guru Baru',
          isActive: true,
          mustChangePassword: true,
          createdAt: '2026-08-25T01:00:00.000Z',
          updatedAt: '2026-08-25T01:00:00.000Z',
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
      },
    });

    expect(response.data[0]).not.toHaveProperty('password');
    expect(response.data[0]).not.toHaveProperty('email');
    expect(response.data[0]).not.toHaveProperty('role');
  });
});
