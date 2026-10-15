import { describe, expect, it } from 'vitest';
import { FaceChallengeRequestSchema, FaceChallengeResponseSchema } from '@absensi/contracts';

describe('face challenge contract', () => {
  it('rejects browser assertions and unknown fields', () => {
    expect(FaceChallengeRequestSchema.safeParse({ action: 'CHECK_IN', passed: true }).success).toBe(false);
    expect(FaceChallengeRequestSchema.safeParse({ action: 'CHECK_IN', frames: ['fake'] }).success).toBe(false);
  });

  it('requires a bounded two-step server challenge', () => {
    expect(FaceChallengeResponseSchema.safeParse({
      challengeId: crypto.randomUUID(),
      steps: ['BLINK', 'TURN_LEFT'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }).success).toBe(true);
    expect(FaceChallengeResponseSchema.safeParse({
      challengeId: crypto.randomUUID(),
      steps: ['BLINK', 'BLINK'],
      expiresAt: new Date().toISOString(),
    }).success).toBe(false);
  });
});
