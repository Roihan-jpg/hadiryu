import type { CalendarException } from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import { resolveCalendarDay } from './calendar-payroll.js';

const holiday: CalendarException = {
  id: '40000000-0000-4000-8000-000000000001',
  workDate: '2026-12-25',
  exceptionType: 'HOLIDAY',
  name: 'Libur Natal',
  scheduleType: null,
};

describe('calendar resolver', () => {
  it('resolves a holiday, special Sunday workday, Saturday, weekday, and Sunday', () => {
    expect(resolveCalendarDay('2026-12-25', holiday)).toMatchObject({
      isWorkingDay: false,
      scheduleType: null,
      exception: holiday,
    });
    expect(
      resolveCalendarDay('2026-08-16', {
        ...holiday,
        workDate: '2026-08-16',
        exceptionType: 'WORKING_DAY',
        name: 'Hari kerja pengganti',
        scheduleType: 'SATURDAY',
      }),
    ).toMatchObject({ isWorkingDay: true, scheduleType: 'SATURDAY' });
    expect(resolveCalendarDay('2026-08-22', null)).toMatchObject({
      isWorkingDay: true,
      scheduleType: 'SATURDAY',
    });
    expect(resolveCalendarDay('2026-08-24', null)).toMatchObject({
      isWorkingDay: true,
      scheduleType: 'WEEKDAY',
    });
    expect(resolveCalendarDay('2026-08-23', null)).toMatchObject({
      isWorkingDay: false,
      scheduleType: null,
    });
  });
});
