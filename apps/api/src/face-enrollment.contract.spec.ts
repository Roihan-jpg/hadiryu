import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FACE_MOTION_POLICY, FaceEnrollmentSessionRequestSchema, FaceEnrollmentSubmissionSchema, FaceEnrollmentStatusSchema, FaceInferenceErrorSchema } from '@absensi/contracts';
import { sanitizeLogRecord } from './observability.js';

describe('enrollment boundaries', () => {
  it('allows only bounded categorical PAD diagnostics and never raw scores or images', () => {
    const stages = [
      {stage:'BLINK',evaluated:8,rejected:1}, {stage:'TURN_RIGHT',evaluated:8,rejected:0},
      {stage:'FRONT',evaluated:1,rejected:0}, {stage:'LEFT',evaluated:1,rejected:0}, {stage:'RIGHT',evaluated:1,rejected:0},
    ];
    const error = {error:{code:'PAD_FAILED',details:{stages}}};
    expect(FaceInferenceErrorSchema.safeParse(error).success).toBe(true);
    for (const rejectionKind of ['MODEL_NOT_REAL', 'BELOW_ACCEPTANCE', 'MIXED']) {
      expect(FaceInferenceErrorSchema.safeParse({error:{code:'PAD_FAILED',details:{stages,rejectionKind}}}).success).toBe(true);
    }
    expect(FaceInferenceErrorSchema.safeParse({error:{code:'PAD_FAILED',details:{stages,rejectionKind:'arbitrary'}}}).success).toBe(false);
    expect(FaceInferenceErrorSchema.safeParse({error:{code:'PAD_FAILED'}}).success).toBe(true);
    for (const extra of [{score:.3}, {frames:['image']}, {embedding:[.1]}]) {
      expect(FaceInferenceErrorSchema.safeParse({error:{code:'PAD_FAILED',details:{stages,...extra}}}).success).toBe(false);
    }
    for (const invalid of [stages.slice(0,4), [...stages.slice(0,4),stages[3]],
      [{...stages[0],rejected:9},...stages.slice(1)], [{...stages[0],evaluated:100},...stages.slice(1)]]) {
      expect(FaceInferenceErrorSchema.safeParse({error:{code:'PAD_FAILED',details:{stages:invalid}}}).success).toBe(false);
    }
    expect(FaceInferenceErrorSchema.safeParse({error:{code:'QUALITY_FAILED',details:{stages}}}).success).toBe(false);
  });
  it('keeps browser guidance and private inference motion thresholds compatible', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../services/face-inference/model-manifest.json', import.meta.url), 'utf8')) as {
      evaluationThresholds: Record<string, number>;
    };
    for (const key of ['neutralYawMaximum', 'turnYawMinimum', 'turnYawMaximum'] as const) {
      expect(manifest.evaluationThresholds[key]).toBe(FACE_MOTION_POLICY[key]);
    }
  });
  it('requires password confirmation and rejects target user and client verdicts', () => {
    expect(FaceEnrollmentSessionRequestSchema.safeParse({}).success).toBe(false);
    expect(FaceEnrollmentSessionRequestSchema.safeParse({ password: 'Good1234' }).success).toBe(true);
    for (const field of ['userId', 'challengePassed', 'faceMatch', 'purpose']) {
      expect(FaceEnrollmentSessionRequestSchema.safeParse({ password: 'Good1234', [field]: 'forged' }).success).toBe(false);
    }
  });

  it('bounds media, rejects unsupported types and requires multiple samples', () => {
    const frame = { mimeType: 'image/jpeg', data: '/9j/AA==' };
    const body = { sessionId: '50000000-0000-4000-8000-000000000001', frames: Array(19).fill(frame), challengeFrameCounts: [8, 8] };
    expect(FaceEnrollmentSubmissionSchema.safeParse(body).success).toBe(true);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, userId: 'other' }).success).toBe(false);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, frames: [frame] }).success).toBe(false);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, frames: Array(61).fill(frame) }).success).toBe(false);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, challengeFrameCounts: [9, 8] }).success).toBe(false);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, frames: [{ ...frame, mimeType: 'image/svg+xml' }, frame, frame] }).success).toBe(false);
    expect(FaceEnrollmentSubmissionSchema.safeParse({ ...body, frames: [{ ...frame, data: 'a'.repeat(350_000) }, frame, frame] }).success).toBe(false);
  });

  it('allows explicit incompatible-model state and re-enrollment without exposing a template', () => {
    expect(FaceEnrollmentStatusSchema.safeParse({ status: 'REENROLLMENT_REQUIRED', modelVersion: 'old-v1' }).success).toBe(true);
    expect(FaceEnrollmentStatusSchema.safeParse({ status: 'ACTIVE', modelVersion: 'v1', embedding: [0.1] }).success).toBe(false);
  });

  it('redacts biometric material and scores in nested application logs', () => {
    const record = sanitizeLogRecord({ event: 'face.test', nested: {
      rawImages: ['image-value'], embedding: [0.1, 0.2], encryptedTemplate: 'ciphertext-value',
      faceMatchScore: 0.99, padScore: 0.98, password: 'credential-value', safe: 'visible',
    } });
    expect(record['nested']).toEqual({ rawImages: '[REDACTED]', embedding: '[REDACTED]', encryptedTemplate: '[REDACTED]', faceMatchScore: '[REDACTED]', padScore: '[REDACTED]', password: '[REDACTED]', safe: 'visible' });
  });

  it('preserves the Excel template checksum used by existing export audits', () => {
    expect(sanitizeLogRecord({ event: 'export', templateChecksum: 'a'.repeat(64) })['templateChecksum']).toBe('a'.repeat(64));
  });
});
