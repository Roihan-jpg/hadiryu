import type {
  AttendanceAdminNote,
  CalendarException,
  CreateAttendanceAdminNote,
  SecurityScheduleSettingsResponse,
} from '@absensi/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAdminAttendanceService,
  type AdminAttendanceRepository,
  type AdminAttendanceSource,
} from './admin-attendance.js';

const actorId = '50000000-0000-4000-8000-000000000099';
const workDate = '2026-08-25';

function source(
  sequence: number,
  input: Partial<AdminAttendanceSource> = {},
): AdminAttendanceSource {
  return {
    teacherId: `50000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    teacherNip: `198700${sequence}`,
    teacherFullName: `Guru ${sequence}`,
    attendance: null,
    approvedLeave: null,
    notes: [],
    ...input,
  };
}

const attendance = {
  id: '40000000-0000-4000-8000-000000000001',
  checkInAt: '2026-08-25T00:00:00.000Z',
  checkOutAt: '2026-08-25T08:35:00.000Z',
  checkoutClose: '17:00',
  targetMinutes: 515,
  workedMinutes: 515,
  workDeficitMinutes: 0,
  arrivalLateMinutes: 0,
  status: 'COMPLETED' as const,
};

class FakeAdminAttendanceRepository implements AdminAttendanceRepository {
  calendarException: CalendarException | null = null;
  records: AdminAttendanceSource[] = [];
  requestedSearch: string | undefined;
  createdNotes: AttendanceAdminNote[] = [];
  securitySettings?: SecurityScheduleSettingsResponse;

  async findCalendarException(): Promise<CalendarException | null> {
    return this.calendarException;
  }

  async findSecuritySchedules(): Promise<SecurityScheduleSettingsResponse> {
    if (!this.securitySettings) throw new Error('Security settings not configured in test');
    return this.securitySettings;
  }

  async listDailySources(
    _workDate: string,
    search?: string,
  ): Promise<AdminAttendanceSource[]> {
    this.requestedSearch = search;
    return this.records;
  }

  async attendanceExists(attendanceId: string): Promise<boolean> {
    return this.records.some((record) => record.attendance?.id === attendanceId);
  }

  async createNote(
    attendanceId: string,
    createdBy: string,
    input: CreateAttendanceAdminNote,
  ): Promise<AttendanceAdminNote> {
    const note: AttendanceAdminNote = {
      id: '60000000-0000-4000-8000-000000000001',
      attendanceId,
      note: input.note,
      createdBy,
      createdByFullName: 'Admin Sekolah',
      createdAt: '2026-08-25T10:05:00.000Z',
    };
    this.createdNotes.push(note);
    return note;
  }
}

function serviceAt(repository: FakeAdminAttendanceRepository, iso: string) {
  return createAdminAttendanceService(repository, () => new Date(iso));
}

describe('admin attendance monitoring service', () => {
  it('derives five exclusive statuses and an exactly matching summary', async () => {
    const repository = new FakeAdminAttendanceRepository();
    repository.records = [
      source(5),
      source(4, { approvedLeave: { leaveType: 'SICK' } }),
      source(3, {
        attendance: {
          ...attendance,
          id: '40000000-0000-4000-8000-000000000003',
          checkOutAt: null,
          workedMinutes: null,
          workDeficitMinutes: null,
          status: 'CHECKED_IN',
        },
      }),
      source(2, {
        attendance: {
          ...attendance,
          id: '40000000-0000-4000-8000-000000000002',
          arrivalLateMinutes: 8,
        },
      }),
      source(1, { attendance }),
    ];

    const result = await serviceAt(
      repository,
      '2026-08-25T10:01:00.000Z',
    ).list({ page: 1, pageSize: 10, workDate });

    expect(result.data.map((record) => record.status)).toEqual([
      'PRESENT',
      'LATE',
      'INCOMPLETE',
      'LEAVE',
      'NOT_PRESENT',
    ]);
    expect(result.summary).toEqual({
      workDate,
      generatedAt: '2026-08-25T10:01:00.000Z',
      present: 1,
      late: 1,
      notPresent: 1,
      incomplete: 1,
      leave: 1,
      off: 0,
      total: 5,
    });
    expect(result.pagination.totalItems).toBe(result.summary.total);
  });

  it('filters status before pagination while keeping the daily summary stable', async () => {
    const repository = new FakeAdminAttendanceRepository();
    repository.records = [
      source(1, { attendance }),
      source(2, {
        attendance: { ...attendance, arrivalLateMinutes: 3 },
      }),
      source(3),
    ];

    const result = await serviceAt(
      repository,
      '2026-08-25T01:00:00.000Z',
    ).list({
      page: 1,
      pageSize: 1,
      workDate,
      status: 'LATE',
      search: 'Guru',
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.status).toBe('LATE');
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    });
    expect(result.summary.total).toBe(3);
    expect(repository.requestedSearch).toBe('Guru');
  });

  it('uses the Jakarta server date and returns no absence on a non-working day', async () => {
    const repository = new FakeAdminAttendanceRepository();
    repository.records = [source(1)];

    const result = await serviceAt(
      repository,
      '2026-08-29T18:00:00.000Z',
    ).list({ page: 1, pageSize: 20 });

    expect(result.summary.workDate).toBe('2026-08-30');
    expect(result.summary.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('marks a roster rest day as off with zero minutes instead of absent', async () => {
    const repository = new FakeAdminAttendanceRepository();
    const guard = source(6, { role: 'SECURITY_GUARD' });
    repository.records = [guard];
    repository.securitySettings = {
      effectiveOn: workDate,
      dayShift: {
        id: '71000000-0000-4000-8000-000000000001', scheduleType: 'SECURITY_DAY',
        checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00',
        checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00',
        targetMinutes: 720, effectiveFrom: workDate, effectiveTo: null,
      },
      nightShift: {
        id: '71000000-0000-4000-8000-000000000001', scheduleType: 'SECURITY_NIGHT',
        checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00',
        checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00',
        targetMinutes: 720, effectiveFrom: workDate, effectiveTo: null,
      },
      roster: {
        dayOneMorningGuardId: '50000000-0000-4000-8000-000000000007',
        dayOneNightGuardId: '50000000-0000-4000-8000-000000000008',
        dayOneOffGuardId: guard.teacherId,
        effectiveFrom: workDate,
        effectiveTo: null,
      },
      preview: [],
    };

    const result = await serviceAt(repository, '2026-08-25T01:00:00.000Z')
      .list({ page: 1, pageSize: 20, workDate });

    expect(result.data[0]).toMatchObject({
      role: 'SECURITY_GUARD',
      status: 'OFF',
      scheduleType: null,
      workedMinutes: 0,
      workDeficitMinutes: 0,
    });
    expect(result.summary).toMatchObject({ off: 1, notPresent: 0, total: 1 });
  });

  it('uses the timestamp snapshot before marking an overnight shift incomplete', async () => {
    const repository = new FakeAdminAttendanceRepository();
    repository.records = [source(1, {
      role: 'SECURITY_GUARD',
      attendance: {
        ...attendance,
        checkOutAt: null,
        workedMinutes: null,
        workDeficitMinutes: null,
        status: 'CHECKED_IN',
        scheduleType: 'SECURITY_NIGHT',
        checkoutClose: '08:00',
        checkoutCloseAt: '2026-08-26T01:00:00.000Z',
      },
    })];

    const result = await serviceAt(repository, '2026-08-25T23:30:00.000Z')
      .list({ page: 1, pageSize: 20, workDate });

    expect(result.data[0]?.status).toBe('PRESENT');
  });

  it('appends a note without exposing any attendance correction input', async () => {
    const repository = new FakeAdminAttendanceRepository();
    repository.records = [source(1, { attendance })];
    const service = serviceAt(repository, '2026-08-25T10:05:00.000Z');

    const result = await service.addNote(actorId, attendance.id, {
      note: 'Data pendukung sudah diperiksa',
    });

    expect(result).toMatchObject({
      attendanceId: attendance.id,
      createdBy: actorId,
      note: 'Data pendukung sudah diperiksa',
    });
    expect(repository.createdNotes).toHaveLength(1);
    expect(repository.records[0]?.attendance).toEqual(attendance);
  });

  it('rejects a note for an unknown attendance record', async () => {
    const repository = new FakeAdminAttendanceRepository();

    await expect(
      serviceAt(repository, '2026-08-25T10:05:00.000Z').addNote(
        actorId,
        attendance.id,
        { note: 'Tidak boleh tersimpan' },
      ),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_NOT_FOUND', status: 404 });
  });
});
