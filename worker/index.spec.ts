import { describe, expect, it } from 'vitest';

import { hasForeignOrigin, isApiRequest, normalizeSameOriginRequest } from './routing.js';

describe('worker routing', () => {
  it('routes API and health requests to Express', () => {
    expect(isApiRequest('/api/auth/me')).toBe(true);
    expect(isApiRequest('/health')).toBe(true);
    expect(isApiRequest('/admin')).toBe(false);
  });

  it('removes only a same-origin Origin header before the Node bridge', () => {
    const sameOrigin = normalizeSameOriginRequest(new Request(
      'https://absensi.example/api/auth/login',
      { headers: { origin: 'https://absensi.example' } },
    ));
    const foreignOrigin = normalizeSameOriginRequest(new Request(
      'https://absensi.example/api/auth/login',
      { headers: { origin: 'https://attacker.example' } },
    ));
    expect(sameOrigin.headers.has('origin')).toBe(false);
    expect(foreignOrigin.headers.get('origin')).toBe('https://attacker.example');
    expect(hasForeignOrigin(sameOrigin)).toBe(false);
    expect(hasForeignOrigin(foreignOrigin)).toBe(true);
    expect(
      hasForeignOrigin(foreignOrigin, ['https://attacker.example']),
    ).toBe(false);
  });
});
