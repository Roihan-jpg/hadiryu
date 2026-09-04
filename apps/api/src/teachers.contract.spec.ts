import {
  CreateTeacherRequestSchema,
  ListTeachersQuerySchema,
  PasswordResetResponseSchema,
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

  it('normalizes account filters and an optional WhatsApp number', () => {
    expect(
      ListTeachersQuerySchema.parse({
        isActive: 'true',
        mustChangePassword: 'false',
      }),
    ).toEqual({
      page: 1,
      pageSize: 20,
      isActive: true,
      mustChangePassword: false,
    });

    expect(
      CreateTeacherRequestSchema.parse({
        nip: '19870001',
        fullName: 'Guru Baru',
        initialPassword: 'Sementara-123',
        whatsappNumber: '  +628123456789  ',
      }).whatsappNumber,
    ).toBe('+628123456789');
    expect(
      CreateTeacherRequestSchema.safeParse({
        nip: '19870001',
        fullName: 'Guru Baru',
        initialPassword: 'Sementara-123',
        whatsappNumber: '08123456789',
      }).success,
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

  it('accepts an empty reset request and exposes the generated password only in its response', () => {
    expect(ResetTeacherPasswordRequestSchema.parse({})).toEqual({});
    expect(
      ResetTeacherPasswordRequestSchema.safeParse({
        temporaryPassword: 'Password-Baru-123',
      }).success,
    ).toBe(false);

    const response = TeacherListResponseSchema.parse({
      data: [
        {
          id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
          nip: '19870001',
          fullName: 'Guru Baru',
          whatsappNumber: null,
          isActive: true,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: null,
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

    expect(
      PasswordResetResponseSchema.parse({
        teacher: {
          ...response.data[0],
          temporaryPasswordExpiresAt: '2026-08-28T01:00:00.000Z',
        },
        temporaryPassword: 'AG-2026-vA7Qm2pR',
        expiresAt: '2026-08-28T01:00:00.000Z',
      }).temporaryPassword,
    ).toBe('AG-2026-vA7Qm2pR');
  });
});
