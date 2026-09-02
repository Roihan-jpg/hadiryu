import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  MonthlyReportDay,
  MonthlyReportParams,
  MonthlyReportPreview,
  MonthlyReportTeacher,
} from '@absensi/contracts';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  createExcelExportService,
  type ExcelExportAudit,
  type ExcelExportAuditRepository,
} from './excel-export.js';
import type { MonthlyReportService } from './monthly-report.js';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const templatePath = path.join(repositoryRoot, 'report-template.xlsx');
const teacherId = '50000000-0000-4000-8000-000000000001';

function reportDates(year: number, month: number): string[] {
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from(
    { length: dayCount },
    (_, index) =>
      `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`,
  );
}

function nonWorkingDay(workDate: string): MonthlyReportDay {
  return {
    workDate,
    scheduleType: null,
    status: 'NON_WORKING_DAY',
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: null,
    workEnd: null,
    targetMinutes: 0,
    workedMinutes: 0,
    arrivalLateMinutes: 0,
    workDeficitMinutes: 0,
    leaveType: null,
    calendarExceptionName: null,
  };
}

function teacher(
  year: number,
  month: number,
  input: Partial<MonthlyReportTeacher> = {},
): MonthlyReportTeacher {
  const days = reportDates(year, month).map(nonWorkingDay);
  days[0] = {
    workDate: days[0]!.workDate,
    scheduleType: 'SATURDAY',
    status: 'WORKED',
    attendanceId: '40000000-0000-4000-8000-000000000001',
    checkInAt: '2026-08-01T00:05:00.000Z',
    checkOutAt: '2026-08-01T03:35:00.000Z',
    workStart: '07:00',
    workEnd: '10:35',
    targetMinutes: 215,
    workedMinutes: 210,
    arrivalLateMinutes: 5,
    workDeficitMinutes: 5,
    leaveType: null,
    calendarExceptionName: null,
  };
  days[2] = {
    workDate: days[2]!.workDate,
    scheduleType: 'WEEKDAY',
    status: 'LEAVE',
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: '07:00',
    workEnd: '15:35',
    targetMinutes: 515,
    workedMinutes: 515,
    arrivalLateMinutes: 0,
    workDeficitMinutes: 0,
    leaveType: 'SICK',
    calendarExceptionName: null,
  };
  days[3] = {
    workDate: days[3]!.workDate,
    scheduleType: 'WEEKDAY',
    status: 'ABSENT',
    attendanceId: null,
    checkInAt: null,
    checkOutAt: null,
    workStart: '07:00',
    workEnd: '15:35',
    targetMinutes: 515,
    workedMinutes: 0,
    arrivalLateMinutes: 0,
    workDeficitMinutes: 515,
    leaveType: null,
    calendarExceptionName: null,
  };
  days[4] = {
    workDate: days[4]!.workDate,
    scheduleType: 'WEEKDAY',
    status: 'INCOMPLETE',
    attendanceId: '40000000-0000-4000-8000-000000000002',
    checkInAt: '2026-08-05T00:00:00.000Z',
    checkOutAt: null,
    workStart: '07:00',
    workEnd: '15:35',
    targetMinutes: 515,
    workedMinutes: 455,
    arrivalLateMinutes: 0,
    workDeficitMinutes: 60,
    leaveType: null,
    calendarExceptionName: null,
  };
  return {
    teacherId,
    teacherNip: '1987001',
    teacherFullName: 'Guru Satu',
    days,
    totalWorkDeficitMinutes: 580,
    lateDayCount: 0,
    absentDayCount: 0,
    rejectedEarlyDepartureMinutes: 0,
    ...input,
  };
}

function preview(year: number, month: number): MonthlyReportPreview {
  const dates = reportDates(year, month);
  return {
    year,
    month,
    startDate: dates[0]!,
    endDate: dates.at(-1)!,
    generatedAt: '2030-01-01T00:00:00.000Z',
    teachers: [teacher(year, month)],
  };
}

class FakeMonthlyReportService implements MonthlyReportService {
  constructor(private readonly result: MonthlyReportPreview) {}
  calls: MonthlyReportParams[] = [];

  async preview(input: MonthlyReportParams): Promise<MonthlyReportPreview> {
    this.calls.push(input);
    return this.result;
  }
}

class FakeAuditRepository implements ExcelExportAuditRepository {
  calls: ExcelExportAudit[] = [];

  async recordExport(audit: ExcelExportAudit): Promise<void> {
    this.calls.push(audit);
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function excelMinutes(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return Math.round(value * 24 * 60);
  if (value instanceof Date) {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }
  throw new Error(`Nilai waktu Excel tidak valid: ${String(value)}`);
}

function workbookProblems(workbook: ExcelJS.Workbook): string[] {
  const errors = new Set([
    '#NUM!',
    '#REF!',
    '#VALUE!',
    '#DIV/0!',
    '#NAME?',
    '#N/A',
  ]);
  const problems: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (cell.type === ExcelJS.ValueType.Formula) problems.push(cell.address);
        if (typeof value === 'string' && errors.has(value.trim())) {
          problems.push(cell.address);
        }
        if (
          value &&
          typeof value === 'object' &&
          'error' in value &&
          errors.has(String(value.error))
        ) {
          problems.push(cell.address);
        }
      });
    });
  });
  return problems;
}

describe('Excel monthly report exporter', () => {
  it.each([
    [2027, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 8, 31],
  ])(
    'maps a %i-%i calendar month with %i days without changing the template',
    async (year, month, dayCount) => {
      const report = preview(year, month);
      const calculator = new FakeMonthlyReportService(report);
      const audit = new FakeAuditRepository();
      const templateBefore = await readFile(templatePath);
      const service = createExcelExportService(calculator, audit, {
        templatePath,
        now: () => new Date('2030-01-02T03:04:05.000Z'),
      });

      const result = await service.export({ year, month }, teacherId);
      const templateAfter = await readFile(templatePath);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(toArrayBuffer(result.buffer));
      const sheet = workbook.getWorksheet('Sheet1')!;

      expect(sha256(templateAfter)).toBe(sha256(templateBefore));
      expect(workbook.worksheets.map((item) => item.name)).toEqual(['Sheet1']);
      expect(sheet.getCell(1, 2).value).toBe('Guru Satu');
      expect(sheet.getCell(2 + dayCount, 1).value).not.toBeNull();
      expect(sheet.getCell(3 + dayCount, 1).value).toBeNull();
      expect(sheet.getCell(79, 2).value).toBeNull();
      expect(workbookProblems(workbook)).toEqual([]);
      expect(result.fileName).toBe(
        `laporan-absensi-${year}-${String(month).padStart(2, '0')}.xlsx`,
      );
      expect(calculator.calls).toEqual([{ year, month }]);
      expect(audit.calls).toEqual([
        {
          actorId: teacherId,
          generator: 'exceljs@4.4.0',
          period: `${year}-${String(month).padStart(2, '0')}`,
          teacherCount: 1,
          templateChecksum: sha256(templateBefore),
          exportedAt: '2030-01-02T03:04:05.000Z',
        },
      ]);
    },
  );

  it('writes daily attendance, leave, absence, incomplete values, and backend totals', async () => {
    const audit = new FakeAuditRepository();
    const service = createExcelExportService(
      new FakeMonthlyReportService(preview(2026, 8)),
      audit,
      { templatePath },
    );

    const result = await service.export({ year: 2026, month: 8 }, teacherId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));
    const sheet = workbook.getWorksheet('Sheet1')!;

    expect(excelMinutes(sheet.getCell('B3').value)).toBe(7 * 60 + 5);
    expect(excelMinutes(sheet.getCell('C3').value)).toBe(10 * 60 + 35);
    expect(excelMinutes(sheet.getCell('D3').value)).toBe(210);
    expect(sheet.getCell('E3').value).toBe(210);
    expect(sheet.getCell('F3').value).toBe(5);
    expect(sheet.getCell('B5').value).toBe('SAKIT');
    expect(excelMinutes(sheet.getCell('D5').value)).toBe(515);
    expect(sheet.getCell('E5').value).toBe(515);
    expect(sheet.getCell('F5').value).toBe(0);
    expect(excelMinutes(sheet.getCell('D6').value)).toBe(0);
    expect(sheet.getCell('E6').value).toBe(0);
    expect(sheet.getCell('F6').value).toBe(515);
    expect(excelMinutes(sheet.getCell('B7').value)).toBe(7 * 60);
    expect(sheet.getCell('C7').value).toBeNull();
    expect(excelMinutes(sheet.getCell('D7').value)).toBe(455);
    expect(sheet.getCell('F7').value).toBe(60);
    expect(sheet.getCell('F34').value).toBe(580);
    expect(sheet.getCell('F35').value).toBeNull();
    expect(sheet.getCell('F36').value).toBeNull();
    expect(sheet.getCell('F37').value).toBeNull();
    expect(sheet.getCell('B3').numFmt).toBe('hh:mm');
    expect(sheet.getCell('D3').numFmt).toBe('[h]:mm');
    expect(sheet.getCell('F35').numFmt).toContain('Rp');
    expect(
      (sheet.getCell('B3').fill as ExcelJS.FillPattern).fgColor?.argb,
    ).toBe('FFFFFF00');
    expect(
      (sheet.getCell('B4').fill as ExcelJS.FillPattern).fgColor?.argb,
    ).toBe('FFFF0000');
  });

  it('uses all 56 built-in slots and adds one styled four-teacher block for teacher 57', async () => {
    const report = preview(2026, 8);
    report.teachers = Array.from({ length: 57 }, (_, index) =>
      teacher(2026, 8, {
        teacherId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        teacherNip: String(index + 1).padStart(3, '0'),
        teacherFullName: `Guru ${String(index + 1).padStart(2, '0')}`,
      }),
    );
    const service = createExcelExportService(
      new FakeMonthlyReportService(report),
      new FakeAuditRepository(),
      { templatePath },
    );

    const result = await service.export({ year: 2026, month: 8 }, teacherId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));
    const sheet = workbook.getWorksheet('Sheet1')!;

    expect(sheet.getCell(1, 206).value).toBe('Guru 40');
    expect(sheet.getCell(40, 2).value).toBe('Guru 41');
    expect(sheet.getCell(40, 80).value).toBe('Guru 56');
    expect(sheet.getCell(40, 86).value).toBe('Guru 57');
    expect(sheet.getCell(40, 86).isMerged).toBe(true);
    expect(sheet.getCell(40, 90).master.address).toBe(
      sheet.getCell(40, 86).address,
    );
    expect(sheet.getCell(73, 86).isMerged).toBe(true);
    expect(sheet.getColumn(85).width).toBe(sheet.getColumn(1).width);
    expect(sheet.getColumn(86).width).toBe(sheet.getColumn(2).width);
    expect(sheet.getCell(40, 86).style).toEqual(sheet.getCell(40, 2).style);
    expect(sheet.getCell(42, 86).border).toEqual(sheet.getCell(42, 2).border);
    expect(sheet.getCell(42, 86).fill).toEqual(sheet.getCell(42, 2).fill);
    expect(sheet.getCell(76, 90).value).toBeNull();
    expect(workbookProblems(workbook)).toEqual([]);
  });

  it('fills exactly 56 built-in slots without creating another teacher block', async () => {
    const report = preview(2026, 8);
    report.teachers = Array.from({ length: 56 }, (_, index) =>
      teacher(2026, 8, {
        teacherId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        teacherNip: String(index + 1).padStart(3, '0'),
        teacherFullName: `Guru ${String(index + 1).padStart(2, '0')}`,
      }),
    );
    const service = createExcelExportService(
      new FakeMonthlyReportService(report),
      new FakeAuditRepository(),
      { templatePath },
    );

    const result = await service.export({ year: 2026, month: 8 }, teacherId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));
    const sheet = workbook.getWorksheet('Sheet1')!;

    expect(sheet.getCell(40, 80).value).toBe('Guru 56');
    expect(sheet.getCell(40, 86).value).toBeNull();
    expect(workbookProblems(workbook)).toEqual([]);
  });

  it.each([
    ['SICK', 'SAKIT'],
    ['OFFICIAL_DUTY', 'DINAS'],
    ['FAMILY', 'KELUARGA'],
    ['OTHER', 'LAINNYA'],
  ] as const)('writes the %s leave code as %s', async (leaveType, code) => {
    const report = preview(2026, 8);
    const leaveDay = report.teachers[0]!.days[2]!;
    if (leaveDay.status !== 'LEAVE') throw new Error('Fixture izin tidak valid');
    leaveDay.leaveType = leaveType;
    const service = createExcelExportService(
      new FakeMonthlyReportService(report),
      new FakeAuditRepository(),
      { templatePath },
    );

    const result = await service.export({ year: 2026, month: 8 }, teacherId);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));

    expect(workbook.getWorksheet('Sheet1')!.getCell('B5').value).toBe(code);
  });

  it('rejects a remaining error cell before recording the export audit', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'absensi-excel-export-'),
    );
    try {
      const corruptTemplatePath = path.join(
        temporaryDirectory,
        'corrupt-template.xlsx',
      );
      const corruptTemplate = new ExcelJS.Workbook();
      await corruptTemplate.xlsx.readFile(templatePath);
      corruptTemplate.addWorksheet('Corrupt').getCell('A1').value = {
        error: '#REF!',
      };
      await corruptTemplate.xlsx.writeFile(corruptTemplatePath);
      const audit = new FakeAuditRepository();
      const service = createExcelExportService(
        new FakeMonthlyReportService(preview(2026, 8)),
        audit,
        { templatePath: corruptTemplatePath },
      );

      await expect(
        service.export({ year: 2026, month: 8 }, teacherId),
      ).rejects.toMatchObject({
        status: 500,
        code: 'EXCEL_EXPORT_INVALID',
        details: { cells: ['Corrupt!A1'] },
      });
      expect(audit.calls).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
