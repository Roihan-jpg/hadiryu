import { describe, expect, it } from 'vitest';

import { toSecurityScheduleSettings } from './supabase-settings.js';

describe('Supabase security settings mapping', () => {
  it('accepts the audit timestamps returned by the composite save RPC', () => {
    const result = toSecurityScheduleSettings({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      day_shift: {
        checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00',
        checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00', targetMinutes: 720,
      },
      night_shift: {
        checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
        checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
      },
      day_one_morning_guard_id: '11111111-1111-4111-8111-111111111111',
      day_one_night_guard_id: '22222222-2222-4222-8222-222222222222',
      day_one_off_guard_id: '33333333-3333-4333-8333-333333333333',
      effective_from: '2026-09-08',
      effective_to: null,
      created_at: '2026-09-08T00:00:00.000Z',
      updated_at: '2026-09-08T00:00:00.000Z',
    }, '2026-09-08');

    expect(result.dayShift?.scheduleType).toBe('SECURITY_DAY');
    expect(result.nightShift?.scheduleType).toBe('SECURITY_NIGHT');
    expect(result.preview).toHaveLength(3);
  });
});
