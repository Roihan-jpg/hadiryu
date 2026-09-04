import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './supabase-auth.js';
import { generatePassword } from './supabase-teachers.js';

describe('application credentials', () => {
  it('stores versioned scrypt hashes without plaintext', async () => {
    const hash = await hashPassword('Guru1234');
    expect(hash).toMatch(/^scrypt\$1\$16384\$8\$1\$/);
    expect(hash).not.toContain('Guru1234');
    await expect(verifyPassword('Guru1234', hash)).resolves.toBe(true);
    await expect(verifyPassword('Salah123', hash)).resolves.toBe(false);
  });

  it('generates permanent passwords matching the eight-character policy', () => {
    for (let index = 0; index < 32; index += 1) {
      expect(generatePassword()).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{8}$/);
    }
  });
});
