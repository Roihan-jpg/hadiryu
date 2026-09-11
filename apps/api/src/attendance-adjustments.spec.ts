import { describe, expect, it } from 'vitest';

import { adjustedAttendanceMetrics } from './attendance-adjustments.js';

const completed = {
  workDate: '2026-06-01',
  checkInAt: '2026-06-01T00:05:00.000Z',
  checkOutAt: '2026-06-01T07:05:00.000Z',
  workStart: '07:00',
  workEnd: '15:35',
  targetMinutes: 515,
  workedMinutes: 420,
  workDeficitMinutes: 95,
  arrivalLateMinutes: 5,
  status: 'COMPLETED' as const,
};

describe('adjusted attendance metrics', () => {
  it.each(['PENDING', 'APPROVED'] as const)(
    'credits arrival time and clears lateness while late permission is %s',
    (lateArrivalStatus) => {
      expect(adjustedAttendanceMetrics(completed, { lateArrivalStatus }))
        .toEqual({ workedMinutes: 425, workDeficitMinutes: 90, arrivalLateMinutes: 0 });
    },
  );

  it('keeps actual arrival metrics after late permission is rejected', () => {
    expect(adjustedAttendanceMetrics(completed, { lateArrivalStatus: 'REJECTED' }))
      .toEqual({ workedMinutes: 420, workDeficitMinutes: 95, arrivalLateMinutes: 5 });
  });

  it('credits early departure and late arrival as independent time segments', () => {
    expect(adjustedAttendanceMetrics(completed, {
      lateArrivalStatus: 'REJECTED',
      earlyDepartureStatus: 'APPROVED',
    })).toEqual({ workedMinutes: 510, workDeficitMinutes: 5, arrivalLateMinutes: 5 });

    expect(adjustedAttendanceMetrics(completed, {
      lateArrivalStatus: 'APPROVED',
      earlyDepartureStatus: 'APPROVED',
    })).toEqual({ workedMinutes: 515, workDeficitMinutes: 0, arrivalLateMinutes: 0 });
  });

  it('keeps the fixed forgotten-checkout deficit while clearing approved lateness', () => {
    expect(adjustedAttendanceMetrics({
      ...completed,
      checkOutAt: null,
      workedMinutes: 455,
      workDeficitMinutes: 60,
      status: 'INCOMPLETE',
    }, { lateArrivalStatus: 'APPROVED' })).toEqual({
      workedMinutes: 455,
      workDeficitMinutes: 60,
      arrivalLateMinutes: 0,
    });
  });
});
