import {
  AuthUserSchema,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  UserRoleSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('auth contracts', () => {
  it('accepts the two product roles and rejects any additional role', () => {
    expect(UserRoleSchema.parse('USER')).toBe('USER');
    expect(UserRoleSchema.parse('SUPER_ADMIN')).toBe('SUPER_ADMIN');
    expect(UserRoleSchema.safeParse('ADMIN').success).toBe(false);
  });

  it('trims a valid NIP without converting it to a number', () => {
    const result = LoginRequestSchema.parse({
      nip: ' 001234567890 ',
      password: 'rahasia-sementara',
    });

    expect(result.nip).toBe('001234567890');
  });

  it('rejects NIP characters that cannot be mapped safely to an internal email', () => {
    const result = LoginRequestSchema.safeParse({
      nip: 'guru 01',
      password: 'rahasia-sementara',
    });

    expect(result.success).toBe(false);
  });

  it('requires the current password and a strong replacement password', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({
        currentPassword: 'password-lama',
        newPassword: 'pendek',
      }).success,
    ).toBe(false);
  });

  it('represents only the application profile and never an internal Auth email', () => {
    const user = AuthUserSchema.parse({
      id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
      nip: '001234567890',
      fullName: 'Guru Contoh',
      role: 'USER',
      isActive: true,
      mustChangePassword: true,
    });

    expect(user).not.toHaveProperty('email');
  });
});
