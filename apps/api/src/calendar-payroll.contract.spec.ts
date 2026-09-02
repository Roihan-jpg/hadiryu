import { CalendarExceptionInputSchema } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

describe('calendar contracts', () => {
  it('accepts holidays and working-day overrides, but never a per-teacher setting', () => {
    expect(
      CalendarExceptionInputSchema.parse({
        workDate: '2026-12-25',
        exceptionType: 'HOLIDAY',
        name: 'Libur Natal',
        scheduleType: null,
      }),
    ).toMatchObject({ exceptionType: 'HOLIDAY', scheduleType: null });
    expect(
      CalendarExceptionInputSchema.parse({
        workDate: '2026-08-17',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
      }),
    ).toMatchObject({ exceptionType: 'WORKING_DAY', scheduleType: 'SATURDAY' });
    expect(
      CalendarExceptionInputSchema.safeParse({
        workDate: '2026-08-17',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
        teacherId: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
      }).success,
    ).toBe(false);
  });
});
