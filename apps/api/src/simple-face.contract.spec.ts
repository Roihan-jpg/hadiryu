import { describe, expect, it } from 'vitest';
import { SimpleFaceInferenceRequestSchema, SimpleFaceAttendanceSubmissionSchema } from '@absensi/contracts';

const id = '50000000-0000-4000-8000-000000000001';
const frame = { mimeType: 'image/jpeg', data: 'AAAA' };
describe('simple face boundaries', () => {
  it('requires exactly three enrollment frames and one verification frame', () => {
    for (const operation of ['ENROLLMENT', 'VERIFICATION']) {
      for (const count of [0, 1, 2, 3, 4]) {
        expect(SimpleFaceInferenceRequestSchema.safeParse({ sessionId: id, modelVersion: 'test', operation,
          frames: Array(count).fill(frame) }).success).toBe(count === (operation === 'ENROLLMENT' ? 3 : 1));
      }
    }
  });
  it('rejects client identity and client match decisions', () => {
    const body = { sessionId: id, frame, location: { latitude: 0, longitude: 0, accuracyMeters: 10 } };
    expect(SimpleFaceAttendanceSubmissionSchema.safeParse(body).success).toBe(true);
    for (const extra of [{ userId: id }, { matched: true }, { purpose: 'CHECK_IN' }]) {
      expect(SimpleFaceAttendanceSubmissionSchema.safeParse({ ...body, ...extra }).success).toBe(false);
    }
  });
});
