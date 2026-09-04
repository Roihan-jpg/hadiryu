import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  MonthlyReportParamsSchema,
  type AuthUser,
  LeaveType,
  MonthlyReportDay,
  MonthlyReportParams,
  MonthlyReportPreview,
  MonthlyReportTeacher,
} from '@absensi/contracts';
import ExcelJS from 'exceljs';
import type { Express } from 'express';

import {
  AppError,
  createSessionGuard,
  requireRole,
  type AuthService,
} from './auth.js';
import type { MonthlyReportService } from './monthly-report.js';

const FIRST_SECTION_CAPACITY = 40;
const TEACHERS_PER_GROUP = 4;
const COLUMNS_PER_TEACHER = 5;
const COLUMNS_PER_GROUP = 21;
const DAILY_ROW_CAPACITY = 31;
const EXCEL_ERROR_VALUES = new Set([
  '#NUM!',
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#NAME?',
  '#N/A',
]);
const LEAVE_CODES: Record<LeaveType, string> = {
  SICK: 'SAKIT',
  OFFICIAL_DUTY: 'DINAS',
  FAMILY: 'KELUARGA',
  OTHER: 'LAINNYA',
};
const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface ExcelExportAudit {
  actorId: string;
  generator: 'exceljs@4.4.0';
  period: string;
  teacherCount: number;
  templateChecksum: string;
  exportedAt: string;
}

export interface ExcelExportAuditRepository {
  recordExport(audit: ExcelExportAudit): Promise<void>;
}

export interface ExcelExportResult {
  buffer: Buffer;
  fileName: string;
}

export interface ExcelExportService {
  export(
    input: MonthlyReportParams,
    actorId: string,
  ): Promise<ExcelExportResult>;
}

type ExcelExportOptions = ({ templatePath: string } | { loadTemplate: () => Promise<Uint8Array> }) & {
  now?: () => Date;
};

interface SectionLayout {
  headerRow: number;
  subheaderRow: number;
  dayStartRow: number;
  totalStartRow: number;
}

const FIRST_SECTION: SectionLayout = {
  headerRow: 1,
  subheaderRow: 2,
  dayStartRow: 3,
  totalStartRow: 34,
};
const SECOND_SECTION: SectionLayout = {
  headerRow: 40,
  subheaderRow: 41,
  dayStartRow: 42,
  totalStartRow: 73,
};

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function period(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function excelDate(workDate: string): Date {
  return new Date(`${workDate}T00:00:00.000Z`);
}

function jakartaTimeFraction(timestamp: string): number {
  const parts = TIME_FORMATTER.formatToParts(new Date(timestamp));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return (hour * 60 + minute) / (24 * 60);
}

function cloneFill(fill: ExcelJS.Fill): ExcelJS.Fill {
  return structuredClone(fill);
}

function setNumberFormat(cell: ExcelJS.Cell, numFmt: string): void {
  cell.style = { ...structuredClone(cell.style), numFmt };
}

function clearTemplateValues(
  sheet: ExcelJS.Worksheet,
  lastColumn: number,
): void {
  const lastRow = Math.max(sheet.rowCount, 106);
  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      sheet.getCell(row, column).value = null;
    }
  }
}

function copySecondSectionGroupStyle(
  sheet: ExcelJS.Worksheet,
  destinationBaseColumn: number,
): void {
  for (let offset = 0; offset < COLUMNS_PER_GROUP; offset += 1) {
    const sourceColumn = sheet.getColumn(1 + offset);
    const destinationColumn = sheet.getColumn(destinationBaseColumn + offset);
    if (sourceColumn.width !== undefined) {
      destinationColumn.width = sourceColumn.width;
    }
    destinationColumn.hidden = sourceColumn.hidden;
    if (sourceColumn.outlineLevel !== undefined) {
      destinationColumn.outlineLevel = sourceColumn.outlineLevel;
    }
  }
  for (
    let row = SECOND_SECTION.headerRow;
    row <= SECOND_SECTION.totalStartRow + 3;
    row += 1
  ) {
    for (let offset = 0; offset < COLUMNS_PER_GROUP; offset += 1) {
      sheet.getCell(row, destinationBaseColumn + offset).style = structuredClone(
        sheet.getCell(row, 1 + offset).style,
      );
    }
  }
  for (let slot = 0; slot < TEACHERS_PER_GROUP; slot += 1) {
    const teacherColumn =
      destinationBaseColumn + 1 + slot * COLUMNS_PER_TEACHER;
    sheet.mergeCells(
      SECOND_SECTION.headerRow,
      teacherColumn,
      SECOND_SECTION.headerRow,
      teacherColumn + 4,
    );
    for (let totalOffset = 0; totalOffset < 4; totalOffset += 1) {
      const totalRow = SECOND_SECTION.totalStartRow + totalOffset;
      sheet.mergeCells(
        totalRow,
        teacherColumn,
        totalRow,
        teacherColumn + 3,
      );
    }
  }
}

function ensureSecondSectionCapacity(
  sheet: ExcelJS.Worksheet,
  teacherCount: number,
): number {
  const requiredGroups = Math.ceil(
    Math.max(0, teacherCount - FIRST_SECTION_CAPACITY) / TEACHERS_PER_GROUP,
  );
  for (let group = 4; group < requiredGroups; group += 1) {
    copySecondSectionGroupStyle(sheet, 1 + group * COLUMNS_PER_GROUP);
  }
  return requiredGroups;
}

function setDayFill(
  sheet: ExcelJS.Worksheet,
  row: number,
  baseColumn: number,
  day: MonthlyReportDay,
  fills: { weekday: ExcelJS.Fill; saturday: ExcelJS.Fill; nonWorking: ExcelJS.Fill },
): void {
  const fill =
    day.status === 'NON_WORKING_DAY'
      ? fills.nonWorking
      : day.scheduleType === 'SATURDAY'
        ? fills.saturday
        : fills.weekday;
  for (
    let column = baseColumn + 1;
    column < baseColumn + COLUMNS_PER_GROUP;
    column += 1
  ) {
    const cell = sheet.getCell(row, column);
    cell.style = { ...structuredClone(cell.style), fill: cloneFill(fill) };
  }
}

function writeDay(
  sheet: ExcelJS.Worksheet,
  row: number,
  teacherColumn: number,
  day: MonthlyReportDay,
): void {
  const checkIn = sheet.getCell(row, teacherColumn);
  const checkOut = sheet.getCell(row, teacherColumn + 1);
  const duration = sheet.getCell(row, teacherColumn + 2);
  const workedMinutes = sheet.getCell(row, teacherColumn + 3);
  const deficitMinutes = sheet.getCell(row, teacherColumn + 4);

  setNumberFormat(checkIn, 'hh:mm');
  setNumberFormat(checkOut, 'hh:mm');
  setNumberFormat(duration, '[h]:mm');
  setNumberFormat(workedMinutes, '0');
  setNumberFormat(deficitMinutes, '0');

  if (day.status === 'NON_WORKING_DAY') return;
  if (day.status === 'LEAVE') {
    checkIn.value = LEAVE_CODES[day.leaveType];
  } else if (day.checkInAt !== null) {
    checkIn.value = jakartaTimeFraction(day.checkInAt);
  }
  if (day.checkOutAt !== null) {
    checkOut.value = jakartaTimeFraction(day.checkOutAt);
  }
  duration.value = day.workedMinutes / (24 * 60);
  workedMinutes.value = day.workedMinutes;
  deficitMinutes.value = day.workDeficitMinutes;
}

function writeTeacher(
  sheet: ExcelJS.Worksheet,
  layout: SectionLayout,
  teacherColumn: number,
  teacher: MonthlyReportTeacher,
): void {
  sheet.getCell(layout.headerRow, teacherColumn).value = teacher.teacherFullName;
  ['SCAN IN', 'SCAN OUT', 'JAM KERJA', 'MENIT', 'KEKURANGAN'].forEach(
    (label, index) => {
      sheet.getCell(layout.subheaderRow, teacherColumn + index).value = label;
    },
  );
  teacher.days.forEach((day, index) => {
    writeDay(sheet, layout.dayStartRow + index, teacherColumn, day);
  });

  const totals = [
    ['TOTAL MENIT KEKURANGAN', teacher.totalWorkDeficitMinutes],
    ['TOTAL UPAH KINERJA', null],
    ['ADMINISTRASI', null],
    ['UPAH KINERJA', null],
  ] as const;
  totals.forEach(([label, value], index) => {
    const row = layout.totalStartRow + index;
    sheet.getCell(row, teacherColumn).value = label;
    sheet.getCell(row, teacherColumn + 4).value = value;
    setNumberFormat(sheet.getCell(row, teacherColumn + 4), index === 0 ? '0' : '[$Rp-421] #,##0');
  });
}

function writeGroup(
  sheet: ExcelJS.Worksheet,
  layout: SectionLayout,
  baseColumn: number,
  teachers: readonly MonthlyReportTeacher[],
  fills: { weekday: ExcelJS.Fill; saturday: ExcelJS.Fill; nonWorking: ExcelJS.Fill },
): void {
  const days = teachers[0]?.days ?? [];
  sheet.getCell(layout.headerRow, baseColumn).value = 'TGL';
  sheet.getCell(layout.subheaderRow, baseColumn).value = 'TGL';
  for (let index = 0; index < DAILY_ROW_CAPACITY; index += 1) {
    const day = days[index];
    if (!day) continue;
    const row = layout.dayStartRow + index;
    sheet.getCell(row, baseColumn).value = excelDate(day.workDate);
    setNumberFormat(sheet.getCell(row, baseColumn), 'd-mmm');
    setDayFill(sheet, row, baseColumn, day, fills);
  }
  teachers.forEach((teacher, index) => {
    writeTeacher(
      sheet,
      layout,
      baseColumn + 1 + index * COLUMNS_PER_TEACHER,
      teacher,
    );
  });
}

function containsExcelError(value: ExcelJS.CellValue): boolean {
  if (typeof value === 'string') return EXCEL_ERROR_VALUES.has(value.trim());
  if (!value || typeof value !== 'object') return false;
  if ('error' in value && EXCEL_ERROR_VALUES.has(String(value.error))) return true;
  return 'result' in value && containsExcelError(value.result as ExcelJS.CellValue);
}

function validateWorkbook(workbook: ExcelJS.Workbook): void {
  const problems: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (
          cell.type === ExcelJS.ValueType.Formula ||
          containsExcelError(cell.value)
        ) {
          problems.push(`${sheet.name}!${cell.address}`);
        }
      });
    });
  });
  if (problems.length > 0) {
    throw new AppError(
      500,
      'EXCEL_EXPORT_INVALID',
      'File ekspor mengandung formula atau error cell',
      { cells: problems.slice(0, 20) },
    );
  }
}

function populateWorkbook(
  workbook: ExcelJS.Workbook,
  report: MonthlyReportPreview,
): void {
  const sheet = workbook.getWorksheet('Sheet1');
  if (!sheet) {
    throw new AppError(
      500,
      'EXCEL_TEMPLATE_INVALID',
      'Template laporan tidak memiliki Sheet1',
    );
  }
  for (const name of ['Sheet2', 'Sheet3']) {
    const staleSheet = workbook.getWorksheet(name);
    if (staleSheet) workbook.removeWorksheet(staleSheet.id);
  }

  const fills = {
    weekday: cloneFill(sheet.getCell('B4').fill),
    saturday: cloneFill(sheet.getCell('B7').fill),
    nonWorking: cloneFill(sheet.getCell('B8').fill),
  };
  const requiredSecondSectionGroups = ensureSecondSectionCapacity(
    sheet,
    report.teachers.length,
  );
  const requiredColumnCount = Math.max(
    sheet.columnCount,
    requiredSecondSectionGroups * COLUMNS_PER_GROUP,
  );
  clearTemplateValues(sheet, requiredColumnCount);

  const firstSectionTeachers = report.teachers.slice(0, FIRST_SECTION_CAPACITY);
  for (
    let group = 0;
    group < Math.ceil(firstSectionTeachers.length / TEACHERS_PER_GROUP);
    group += 1
  ) {
    writeGroup(
      sheet,
      FIRST_SECTION,
      1 + group * COLUMNS_PER_GROUP,
      firstSectionTeachers.slice(
        group * TEACHERS_PER_GROUP,
        (group + 1) * TEACHERS_PER_GROUP,
      ),
      fills,
    );
  }
  const secondSectionTeachers = report.teachers.slice(FIRST_SECTION_CAPACITY);
  for (
    let group = 0;
    group < Math.ceil(secondSectionTeachers.length / TEACHERS_PER_GROUP);
    group += 1
  ) {
    writeGroup(
      sheet,
      SECOND_SECTION,
      1 + group * COLUMNS_PER_GROUP,
      secondSectionTeachers.slice(
        group * TEACHERS_PER_GROUP,
        (group + 1) * TEACHERS_PER_GROUP,
      ),
      fills,
    );
  }
}

export function createExcelExportService(
  monthlyReportService: MonthlyReportService,
  auditRepository: ExcelExportAuditRepository,
  options: ExcelExportOptions,
): ExcelExportService {
  const now = options.now ?? (() => new Date());
  return {
    async export(input, actorId) {
      const template = 'loadTemplate' in options
        ? await options.loadTemplate()
        : await readFile(options.templatePath);
      const templateChecksum = sha256(template);
      const report = await monthlyReportService.preview(input);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(toArrayBuffer(template));
      populateWorkbook(workbook, report);
      validateWorkbook(workbook);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const reportPeriod = period(input.year, input.month);
      await auditRepository.recordExport({
        actorId,
        generator: 'exceljs@4.4.0',
        period: reportPeriod,
        teacherCount: report.teachers.length,
        templateChecksum,
        exportedAt: now().toISOString(),
      });
      return {
        buffer,
        fileName: `laporan-absensi-${reportPeriod}.xlsx`,
      };
    },
  };
}

export function registerExcelExportRoutes(
  app: Express,
  authService: AuthService,
  excelExportService: ExcelExportService,
): void {
  app.post(
    '/api/admin/reports/monthly/:year/:month/export',
    createSessionGuard(authService),
    requireRole('SUPER_ADMIN'),
    async (request, response, next) => {
      try {
        const parsed = MonthlyReportParamsSchema.safeParse(request.params);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Periode laporan bulanan tidak valid',
            parsed.error.flatten(),
          );
        }
        const authUser = response.locals['authUser'] as AuthUser;
        const result = await excelExportService.export(parsed.data, authUser.id);
        response
          .status(200)
          .set({
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${result.fileName}"`,
            'Content-Length': String(result.buffer.length),
          })
          .send(result.buffer);
      } catch (error) {
        next(error);
      }
    },
  );
}
