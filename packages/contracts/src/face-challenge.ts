import { z } from 'zod';

// Landmark nose offset divided by cheek width; these values are not angles.
export const FACE_MOTION_POLICY = {
  neutralYawMaximum: 0.1,
  turnYawMinimum: 0.12,
  turnYawMaximum: 0.45,
  poseGoodSamples: 4,
  poseWindowSamples: 5,
} as const;

export const FaceChallengeActionSchema = z.enum(['CHECK_IN', 'CHECKOUT']);
export const FaceChallengeStepSchema = z.enum(['BLINK', 'TURN_LEFT', 'TURN_RIGHT']);

export const FaceChallengeRequestSchema = z.strictObject({
  action: FaceChallengeActionSchema,
});
export type FaceChallengeRequest = z.infer<typeof FaceChallengeRequestSchema>;

export const FaceChallengeResponseSchema = z.strictObject({
  challengeId: z.uuid(),
  steps: z.union([
    z.tuple([z.literal('BLINK'), z.enum(['TURN_LEFT', 'TURN_RIGHT'])]),
    z.tuple([z.enum(['TURN_LEFT', 'TURN_RIGHT']), z.literal('BLINK')]),
  ]),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type FaceChallengeResponse = z.infer<typeof FaceChallengeResponseSchema>;
