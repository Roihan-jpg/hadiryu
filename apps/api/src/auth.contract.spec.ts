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
      password: 'Guru1234',
    });

    expect(result.nip).toBe('001234567890');
  });

  it('rejects NIP characters that cannot be mapped safely to an internal email', () => {
    const result = LoginRequestSchema.safeParse({
      nip: 'guru 01',
      password: 'Guru1234',
    });

    expect(result.success).toBe(false);
  });

  it('requires the current password and a strong replacement password', () => {
    expect(
      ChangePasswordRequestSchema.safeParse({
        currentPassword: 'Guru1234',
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
      photo: null,
    });

    expect(user).not.toHaveProperty('email');
  });

  it('requires exactly eight alphanumeric characters with upper, lower, and digit', () => {
    expect(LoginRequestSchema.safeParse({ nip: 'guru', password: 'Guru1234' }).success).toBe(true);
    for (const password of ['guru1234', 'GURU1234', 'GuruGuru', 'Guru123!', 'Guru12345']) {
      expect(LoginRequestSchema.safeParse({ nip: 'guru', password }).success).toBe(false);
    }
  });
});
