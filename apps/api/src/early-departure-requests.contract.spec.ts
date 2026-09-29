import {
  CreateEarlyDepartureRequestSchema,
  EarlyDepartureRequestSchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('early departure request contracts', () => {
  it('accepts a server-timestamped request and rejects client timestamps', () => {
    expect(
      EarlyDepartureRequestSchema.parse({
        id: '40000000-0000-4000-8000-000000000001',
        attendanceId: '40000000-0000-4000-8000-000000000002',
        teacherId: '50000000-0000-4000-8000-000000000001',
        workDate: '2026-08-31',
        requestedAt: '2026-08-31T06:00:00.000Z',
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
        distanceMeters: 0,
        status: 'PENDING',
        decisionNote: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-08-31T06:00:00.000Z',
        updatedAt: '2026-08-31T06:00:00.000Z',
      }),
    ).toMatchObject({ status: 'PENDING' });

    expect(
      CreateEarlyDepartureRequestSchema.safeParse({
        reason: 'Keperluan keluarga',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 10,
        requestedAt: '2026-08-31T06:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
