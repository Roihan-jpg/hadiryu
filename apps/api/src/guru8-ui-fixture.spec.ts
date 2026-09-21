import { describe, expect, it } from 'vitest';

import {
  GURU8_UI_FIXTURE_END,
  GURU8_UI_FIXTURE_START,
  buildGuru8UiFixture,
  isGuru8UiFixtureTargetUrl,
  isLocalSupabaseUrl,
} from './guru8-ui-fixture.js';

describe('guru8 UI fixture', () => {
  it('covers 30 Jakarta calendar days as 26 work-day records plus four Sundays', () => {
    const fixture = buildGuru8UiFixture();

    expect(fixture.startDate).toBe(GURU8_UI_FIXTURE_START);
    expect(fixture.endDate).toBe(GURU8_UI_FIXTURE_END);
    expect(fixture.attendances).toHaveLength(21);
    expect(fixture.leaves).toHaveLength(5);

    const calendarDates = Array.from({ length: 30 }, (_, index) => {
      const date = new Date('2026-08-14T00:00:00+07:00');
      date.setDate(date.getDate() + index);
      return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    });
    const sundays = calendarDates.filter((date) => new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'Asia/Jakarta',
    }).format(new Date(`${date}T00:00:00+07:00`)) === 'Sun');

    expect(sundays).toEqual(['2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06']);
    expect(fixture.attendances.length + fixture.leaves.length + sundays.length).toBe(30);
    expect(sundays.every((date) =>
      !fixture.attendances.some((record) => record.workDate === date) &&
      !fixture.leaves.some((record) => record.workDate === date),
    )).toBe(true);
    expect(fixture.leaves).toContainEqual({
      workDate: '2026-08-20', leaveType: 'SICK', status: 'APPROVED',
    });
    expect(fixture.attendances.some((record) => record.workDate === '2026-09-13')).toBe(false);
    expect(fixture.leaves.some((record) => record.workDate === '2026-09-13')).toBe(false);
    expect(fixture.earlyDepartures.some((record) => record.workDate === '2026-09-13')).toBe(false);
  });

  it('exposes every request status while respecting the two active monthly quotas', () => {
    const fixture = buildGuru8UiFixture();

    expect(new Set(fixture.leaves.map((leave) => leave.status))).toEqual(
      new Set(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']),
    );
    expect(new Set(fixture.earlyDepartures.map((request) => request.status))).toEqual(
      new Set(['PENDING', 'APPROVED', 'REJECTED']),
    );
    expect(fixture.leaves.filter((leave) =>
      leave.workDate.startsWith('2026-08') &&
      leave.leaveType === 'LATE_ARRIVAL' &&
      ['PENDING', 'APPROVED'].includes(leave.status),
    )).toHaveLength(2);
    expect(fixture.earlyDepartures.filter((request) =>
      request.workDate.startsWith('2026-08') &&
      ['PENDING', 'APPROVED'].includes(request.status),
    )).toHaveLength(2);
  });

  it('ends with a 15-working-day punctual streak for the purple tier', () => {
    const fixture = buildGuru8UiFixture();
    const finalRun = fixture.attendances.filter((record) => record.workDate >= '2026-08-27');

    expect(finalRun).toHaveLength(15);
    expect(finalRun.every((record) => record.arrivalLateMinutes === 0)).toBe(true);
    expect(finalRun.every((record) => record.earlyDepartureStatus === null)).toBe(true);
  });

  it('keeps the hosted fixture within the available schedule history', () => {
    const fixture = buildGuru8UiFixture('hosted');

    expect(fixture.startDate).toBe('2026-08-31');
    expect(fixture.endDate).toBe('2026-09-12');
    expect(fixture.attendances).toHaveLength(7);
    expect(fixture.leaves).toHaveLength(5);
    expect(fixture.earlyDepartures).toHaveLength(3);
    expect(fixture.attendances.every((record) => record.workDate >= '2026-08-31')).toBe(true);
    expect(fixture.leaves.every((request) => request.workDate >= '2026-08-31')).toBe(true);
    expect(fixture.attendances.length + fixture.leaves.length + 1).toBe(13);
    expect(fixture.attendances.some((record) => record.workDate === '2026-09-06')).toBe(false);
    expect(fixture.leaves.some((request) => request.workDate === '2026-09-06')).toBe(false);
  });

  it.each([
    ['http://127.0.0.1:54321', true],
    ['http://localhost:54321', true],
    ['https://buyerproject.supabase.co', false],
    ['http://localhost.evil.example:54321', false],
  ])('accepts only local Supabase URLs: %s', (url, expected) => {
    expect(isLocalSupabaseUrl(url)).toBe(expected);
  });

  it('permits hosted seeding only for a valid Supabase hosted project URL', () => {
    expect(isGuru8UiFixtureTargetUrl(
      'hosted',
      'https://buyerproject.supabase.co',
    )).toBe(true);
    expect(isGuru8UiFixtureTargetUrl(
      'hosted',
      'https://example.com',
    )).toBe(false);
    expect(isGuru8UiFixtureTargetUrl(
      'local',
      'https://buyerproject.supabase.co',
    )).toBe(false);
  });
});
