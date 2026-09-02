import {
  CalendarDayResolutionSchema,
  type CalendarDayResolution,
  type CalendarException,
} from '@absensi/contracts';

function weekday(workDate: string): number {
  const [year, month, day] = workDate.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

export function resolveCalendarDay(
  workDate: string,
  exception: CalendarException | null,
): CalendarDayResolution {
  if (exception?.exceptionType === 'HOLIDAY') {
    return CalendarDayResolutionSchema.parse({
      workDate,
      isWorkingDay: false,
      scheduleType: null,
      exception,
    });
  }
  if (exception?.exceptionType === 'WORKING_DAY') {
    return CalendarDayResolutionSchema.parse({
      workDate,
      isWorkingDay: true,
      scheduleType: exception.scheduleType,
      exception,
    });
  }
  const day = weekday(workDate);
  return CalendarDayResolutionSchema.parse({
    workDate,
    isWorkingDay: day !== 0,
    scheduleType: day === 0 ? null : day === 6 ? 'SATURDAY' : 'WEEKDAY',
    exception: null,
  });
}
