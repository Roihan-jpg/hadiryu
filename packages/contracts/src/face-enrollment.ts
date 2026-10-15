import { z } from 'zod';
import { PasswordSchema } from './auth.js';

export const BiometricTemplateStatusSchema = z.enum(['ACTIVE', 'DISABLED', 'REVOKED']);
export const FaceEnrollmentSessionRequestSchema = z.strictObject({ password: PasswordSchema });
export type FaceEnrollmentSessionRequest = z.infer<typeof FaceEnrollmentSessionRequestSchema>;

// Transport ceilings only; temporal capture and model quality policy remain gated.
export const FACE_FRAME_MAX_BYTES = 256 * 1024;
export const FACE_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
export const FACE_COMPRESSED_MAX_BYTES = Math.floor(2.8 * 1024 * 1024);
export const FaceEnrollmentFrameSchema = z.strictObject({
  mimeType: z.enum(['image/jpeg', 'image/png']),
  data: z.string().min(4).max(Math.ceil(FACE_FRAME_MAX_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const FaceEnrollmentSubmissionSchema = z.strictObject({
  sessionId: z.uuid(),
  frames: z.array(FaceEnrollmentFrameSchema).min(19).max(60),
  challengeFrameCounts: z.tuple([z.number().int().min(8).max(24), z.number().int().min(8).max(24)]),
}).refine((body) => body.challengeFrameCounts[0] + body.challengeFrameCounts[1] + 3 === body.frames.length,
  'Urutan bukti challenge dan tiga pose tidak lengkap')
  .refine((body) => body.frames.every((frame) => frame.data.length / 4 * 3 - (frame.data.endsWith('==') ? 2 : frame.data.endsWith('=') ? 1 : 0) <= FACE_FRAME_MAX_BYTES)
    && body.frames.reduce((bytes, frame) => bytes + frame.data.length / 4 * 3, 0) <= FACE_COMPRESSED_MAX_BYTES,
  'Ukuran frame enrollment melebihi batas');
export type FaceEnrollmentSubmission = z.infer<typeof FaceEnrollmentSubmissionSchema>;

export const FaceEnrollmentStatusSchema = z.strictObject({
  mode: z.literal('SIMPLE_LOCAL').optional(),
  status: z.enum(['NOT_ENROLLED', 'ACTIVE', 'DISABLED', 'REVOKED', 'REENROLLMENT_REQUIRED', 'UNAVAILABLE']),
  modelVersion: z.string().min(1).max(200).nullable(),
});
export type FaceEnrollmentStatus = z.infer<typeof FaceEnrollmentStatusSchema>;

export const EnrollmentStepsSchema = z.tuple([
  z.enum(['BLINK', 'TURN_LEFT', 'TURN_RIGHT']), z.enum(['BLINK', 'TURN_LEFT', 'TURN_RIGHT']),
]).refine((steps) => steps.includes('BLINK') && steps[0] !== steps[1], 'Challenge tidak valid');
export const FaceEnrollmentSessionSchema = z.strictObject({
  sessionId: z.uuid(), expiresAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()), modelVersion: z.string().min(1).max(200),
  steps: EnrollmentStepsSchema,
});
export type FaceEnrollmentSession = z.infer<typeof FaceEnrollmentSessionSchema>;
export const FaceEnrollmentSessionStatusSchema = z.strictObject({
  sessionId: z.uuid(), state: z.enum(['ISSUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED']),
  failureCode: z.string().max(100).nullable(),
});
export const FaceReenrollmentGrantRequestSchema = z.strictObject({ identityReviewed: z.literal(true) });
export const FaceReenrollmentGrantSchema = z.strictObject({ expiresAt: z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString()) });
export const FaceInferenceRequestSchema = FaceEnrollmentSubmissionSchema.safeExtend({
  modelVersion: z.string().min(1).max(200), steps: EnrollmentStepsSchema,
});
export const FaceInferenceResultSchema = z.strictObject({
  modelVersion: z.string().min(1).max(200),
  embedding: z.array(z.number().finite().min(-1).max(1)).length(128),
  durationMs: z.number().finite().nonnegative(),
});
export type FaceInferenceRequest = z.infer<typeof FaceInferenceRequestSchema>;
export type FaceInferenceResult = z.infer<typeof FaceInferenceResultSchema>;

// Categorical evaluation metadata only: no probabilities, pixels, or templates.
export const FacePadDiagnosticsSchema = z.strictObject({
  rejectionKind: z.enum(['MODEL_NOT_REAL', 'BELOW_ACCEPTANCE', 'MIXED']).optional(),
  stages: z.array(z.strictObject({
    stage: z.enum(['BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'FRONT', 'LEFT', 'RIGHT']),
    evaluated: z.number().int().min(1).max(24), rejected: z.number().int().min(0).max(24),
  })).length(5),
}).refine(({stages}) => {
  const names = stages.map(item => item.stage);
  return new Set(names).size === 5 && names.includes('BLINK')
    && names.filter(name => name === 'TURN_LEFT' || name === 'TURN_RIGHT').length === 1
    && ['FRONT', 'LEFT', 'RIGHT'].every(name => names.includes(name as typeof names[number]))
    && stages.every(item => item.rejected <= item.evaluated
      && (['FRONT', 'LEFT', 'RIGHT'].includes(item.stage) ? item.evaluated === 1 : item.evaluated >= 8))
    && stages.some(item => item.rejected > 0);
}, 'Diagnostik PAD tidak valid');
export const FaceInferenceErrorSchema = z.strictObject({error:z.union([
  z.strictObject({code:z.literal('PAD_FAILED'), details:FacePadDiagnosticsSchema.optional()}),
  z.strictObject({code:z.enum(['INFERENCE_BUSY','INFERENCE_TIMEOUT','MODEL_UNAVAILABLE','MODEL_VERSION_MISMATCH',
    'INVALID_IMAGE','IMAGE_LIMIT','ONE_FACE_REQUIRED','QUALITY_FAILED','FACE_NOT_CENTERED','CHALLENGE_FAILED','POSE_FAILED','IDENTITY_INCONSISTENT'])}),
])});
