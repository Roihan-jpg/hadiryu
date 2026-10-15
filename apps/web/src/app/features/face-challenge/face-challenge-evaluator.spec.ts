import { describe, expect, it } from 'vitest';
import { evaluateFrame, advanceChallenge, type ChallengeProgress } from './face-challenge-evaluator';

const ready = { faceCount: 1, brightness: 110, faceWidth: 0.42, centered: true, blinkLeft: 0, blinkRight: 0, yaw: 0 };
const start: ChallengeProgress = { stepIndex: 0, sawOpenEyes: false, sawClosedEyes: false, neutralYaw: null };

describe('face challenge evaluator', () => {
  it('requires one face and gives specific lighting feedback', () => {
    expect(evaluateFrame({ ...ready, faceCount: 0 }).status).toBe('NO_FACE');
    expect(evaluateFrame({ ...ready, faceCount: 2 }).status).toBe('MULTIPLE_FACES');
    expect(evaluateFrame({ ...ready, brightness: 30 }).status).toBe('TOO_DARK');
    expect(evaluateFrame({ ...ready, brightness: 245 }).status).toBe('TOO_BRIGHT');
    expect(evaluateFrame({ ...ready, faceWidth: 0.1 }).status).toBe('TOO_FAR');
    expect(evaluateFrame(ready).status).toBe('READY');
  });

  it('needs open, closed, then open eyes for a blink', () => {
    let progress = advanceChallenge(start, 'BLINK', ready);
    progress = advanceChallenge(progress, 'BLINK', { ...ready, blinkLeft: 0.9, blinkRight: 0.9 });
    expect(progress.stepIndex).toBe(0);
    progress = advanceChallenge(progress, 'BLINK', ready);
    expect(progress.stepIndex).toBe(1);
  });

  it('does not advance on invalid quality or a wrong head direction', () => {
    const blocked = advanceChallenge(start, 'BLINK', { ...ready, faceCount: 2, blinkLeft: 1, blinkRight: 1 });
    expect(blocked).toEqual(start);
    const neutral: ChallengeProgress = { ...start, stepIndex: 1, neutralYaw: 0 };
    expect(advanceChallenge(neutral, 'TURN_LEFT', { ...ready, yaw: -0.25 }).stepIndex).toBe(1);
    expect(advanceChallenge(neutral, 'TURN_LEFT', { ...ready, yaw: 0.25 }).stepIndex).toBe(2);
  });

  it('recognizes a small turn relative to a slightly offset neutral face, but rejects stillness and the opposite direction', () => {
    const neutral = advanceChallenge(start, 'TURN_LEFT', { ...ready, yaw: .07 });
    expect(advanceChallenge(neutral, 'TURN_LEFT', { ...ready, yaw: .205 }).stepIndex).toBe(1);
    expect(advanceChallenge(neutral, 'TURN_RIGHT', { ...ready, yaw: -.065 }).stepIndex).toBe(1);
    for (const yaw of [.07, .085, -.065]) {
      expect(advanceChallenge(neutral, 'TURN_LEFT', { ...ready, yaw }).stepIndex).toBe(0);
    }
  });
});
