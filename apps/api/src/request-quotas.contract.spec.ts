import {
  RequestQuotaQuerySchema,
  RequestQuotaResponseSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('request quota contracts', () => {
  it('accepts a calendar month and reports separate bounded quotas', () => {
    expect(RequestQuotaQuerySchema.parse({ month: '2026-09' })).toEqual({
      month: '2026-09',
    });
    expect(RequestQuotaResponseSchema.parse({
      month: '2026-09',
      lateArrival: { limit: 2, used: 1, remaining: 1 },
      earlyDeparture: { limit: 2, used: 2, remaining: 0 },
    })).toEqual({
      month: '2026-09',
      lateArrival: { limit: 2, used: 1, remaining: 1 },
      earlyDeparture: { limit: 2, used: 2, remaining: 0 },
    });
  });

  it('rejects invalid months and inconsistent quota totals', () => {
    expect(RequestQuotaQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(RequestQuotaResponseSchema.safeParse({
      month: '2026-09',
      lateArrival: { limit: 2, used: 2, remaining: 1 },
      earlyDeparture: { limit: 2, used: 0, remaining: 2 },
    }).success).toBe(false);
  });
});
