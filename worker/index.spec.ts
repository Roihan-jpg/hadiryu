import { describe, expect, it } from 'vitest';

import { isApiRequest } from './routing.js';

describe('worker routing', () => {
  it('routes API and health requests to Express', () => {
    expect(isApiRequest('/api/auth/me')).toBe(true);
    expect(isApiRequest('/health')).toBe(true);
    expect(isApiRequest('/admin')).toBe(false);
  });
});
