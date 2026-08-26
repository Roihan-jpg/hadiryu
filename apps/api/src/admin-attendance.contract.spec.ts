import {
  AdminAttendanceListResponseSchema,
  AdminAttendanceStatusSchema,
  CreateAttendanceAdminNoteSchema,
  ListAdminAttendanceQuerySchema,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

const baseRecord = {
  teacherId: '50000000-0000-4000-8000-000000000001',
  teacherNip: '1987001',
  teacherFullName: 'Guru Satu',
  workDate: '2026-08-25',
  attendanceId: '40000000-0000-4000-8000-000000000001',
  checkInAt: '2026-08-25T00:00:00.000Z',
  checkOutAt: '2026-08-25T08:35:00.000Z',
  workedMinutes: 515,
  workDeficitMinutes: 0,
  arrivalLateMinutes: 0,
  leaveType: null,
  notes: [],
};

describe('admin attendance contracts', () => {
  it('supports every mutually exclusive monitoring status', () => {
    for (const status of [
      'PRESENT',
      'LATE',
      'NOT_PRESENT',
      'INCOMPLETE',
      'LEAVE',
    ]) {
      expect(AdminAttendanceStatusSchema.parse(status)).toBe(status);
    }
  });

  it('parses date, teacher, status, and bounded pagination filters', () => {
    expect(
      ListAdminAttendanceQuerySchema.parse({
        workDate: '2026-08-25',
        status: 'LATE',
        search: '  Guru Satu  ',
        page: '2',
        pageSize: '10',
      }),
    ).toEqual({
      workDate: '2026-08-25',
      status: 'LATE',
      search: 'Guru Satu',
      page: 2,
      pageSize: 10,
    });
    expect(
      ListAdminAttendanceQuerySchema.safeParse({ page: 1, pageSize: 101 })
        .success,
    ).toBe(false);
  });

  it('keeps the summary total equal to its detail status counts', () => {
    const response = AdminAttendanceListResponseSchema.parse({
      summary: {
        workDate: '2026-08-25',
        generatedAt: '2026-08-25T01:00:00.000Z',
        present: 1,
        late: 1,
        notPresent: 1,
        incomplete: 1,
        leave: 1,
        total: 5,
      },
      data: [{ ...baseRecord, status: 'PRESENT' }],
      pagination: {
        page: 1,
        pageSize: 1,
        totalItems: 5,
        totalPages: 5,
      },
    });

    expect(response.summary.total).toBe(5);
    expect(
      AdminAttendanceListResponseSchema.safeParse({
        ...response,
        summary: { ...response.summary, total: 6 },
      }).success,
    ).toBe(false);
  });

  it('trims append-only notes and rejects unknown correction fields', () => {
    expect(
      CreateAttendanceAdminNoteSchema.parse({ note: '  Dokumen sudah dicek  ' }),
    ).toEqual({ note: 'Dokumen sudah dicek' });
    expect(
      CreateAttendanceAdminNoteSchema.safeParse({
        note: 'Koreksi waktu',
        checkInAt: '2026-08-25T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
