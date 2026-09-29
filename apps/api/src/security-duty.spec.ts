import { describe, expect, it } from 'vitest';

import {
  buildSecurityShiftBoundaries,
  resolveSecurityAssignment,
  securityRotationPreview,
} from './security-duty.js';

const roster = {
  dayOneMorningGuardId: '11111111-1111-4111-8111-111111111111',
  dayOneNightGuardId: '22222222-2222-4222-8222-222222222222',
  dayOneOffGuardId: '33333333-3333-4333-8333-333333333333',
  effectiveFrom: '2026-09-07',
  effectiveTo: null,
};

describe('Satpam duty resolver', () => {
  it('rotates morning, night, and off assignments over all three days', () => {
    expect(resolveSecurityAssignment(roster, '2026-09-07', roster.dayOneMorningGuardId)).toMatchObject({ rotationDay: 1, status: 'DAY' });
    expect(resolveSecurityAssignment(roster, '2026-09-08', roster.dayOneMorningGuardId)).toMatchObject({ rotationDay: 2, status: 'NIGHT' });
    expect(resolveSecurityAssignment(roster, '2026-09-09', roster.dayOneMorningGuardId)).toMatchObject({ rotationDay: 3, status: 'OFF' });
  });

  it('keeps rotation deterministic before and after month boundaries', () => {
    expect(resolveSecurityAssignment({ ...roster, effectiveFrom: '2026-08-31' }, '2026-09-02', roster.dayOneOffGuardId)).toMatchObject({ rotationDay: 3, status: 'NIGHT' });
  });

  it('marks guards outside the effective roster as unassigned', () => {
    expect(resolveSecurityAssignment(roster, '2026-09-07', '44444444-4444-4444-8444-444444444444')).toMatchObject({ status: 'UNASSIGNED' });
  });

  it('dates night checkout boundaries on the next Jakarta calendar day', () => {
    expect(buildSecurityShiftBoundaries('2026-09-07', {
      checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
      checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
    }, 'SECURITY_NIGHT')).toEqual({
      checkInOpenAt: '2026-09-07T10:00:00.000Z',
      workStartAt: '2026-09-07T11:00:00.000Z',
      checkInCloseAt: '2026-09-07T13:00:00.000Z',
      checkoutOpenAt: '2026-09-07T22:00:00.000Z',
      workEndAt: '2026-09-07T23:00:00.000Z',
      checkoutCloseAt: '2026-09-08T01:00:00.000Z',
    });
  });

  it('builds the approved three-day preview order', () => {
    expect(securityRotationPreview(roster, '2026-09-07')).toEqual([
      { workDate: '2026-09-07', rotationDay: 1, morningGuardId: roster.dayOneMorningGuardId, nightGuardId: roster.dayOneNightGuardId, offGuardId: roster.dayOneOffGuardId },
      { workDate: '2026-09-08', rotationDay: 2, morningGuardId: roster.dayOneOffGuardId, nightGuardId: roster.dayOneMorningGuardId, offGuardId: roster.dayOneNightGuardId },
      { workDate: '2026-09-09', rotationDay: 3, morningGuardId: roster.dayOneNightGuardId, nightGuardId: roster.dayOneOffGuardId, offGuardId: roster.dayOneMorningGuardId },
    ]);
  });
});
