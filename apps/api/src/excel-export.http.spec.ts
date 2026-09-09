import type { AuthUser, MonthlyReportParams } from '@absensi/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AuthService, SessionResult } from './auth.js';
import type { ExcelExportResult, ExcelExportService } from './excel-export.js';

const admin: AuthUser = {
  id: '50000000-0000-4000-8000-000000000099',
  nip: 'admin',
  fullName: 'Admin Sekolah',
  role: 'SUPER_ADMIN',
  isActive: true,
  mustChangePassword: false,
};
const teacher: AuthUser = {
  ...admin,
  id: '50000000-0000-4000-8000-000000000001',
  role: 'USER',
};

class FakeAuthService implements AuthService {
  constructor(private readonly user: AuthUser) {}
  async authenticate(): Promise<AuthUser> {
    return this.user;
  }
  async login(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async refresh(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async changePassword(): Promise<SessionResult> {
    throw new Error('not used');
  }
  async logout(): Promise<void> {}
}

class FakeExcelExportService implements ExcelExportService {
  calls: Array<{ input: MonthlyReportParams; actorId: string }> = [];

  async export(
    input: MonthlyReportParams,
    actorId: string,
  ): Promise<ExcelExportResult> {
    this.calls.push({ input, actorId });
    return {
      buffer: Buffer.from('xlsx-output'),
      fileName: 'laporan-absensi-2026-08.xlsx',
    };
  }
}

function testApp(user: AuthUser) {
  const excelExportService = new FakeExcelExportService();
  return {
    excelExportService,
    app: createApp({
      authService: new FakeAuthService(user),
      excelExportService,
    }),
  };
}

describe('Excel monthly report export HTTP API', () => {
  it('downloads an xlsx generated for the authenticated SuperAdmin', async () => {
    const { app, excelExportService } = testApp(admin);

    const result = await request(app)
      .post('/api/admin/reports/monthly/2026/8/export')
      .set('Cookie', 'absensi_session=token')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.headers['content-disposition']).toBe(
      'attachment; filename="laporan-absensi-2026-08.xlsx"',
    );
    expect(result.body).toEqual(Buffer.from('xlsx-output'));
    expect(excelExportService.calls).toEqual([
      { input: { year: 2026, month: 8 }, actorId: admin.id },
    ]);
  });

  it('rejects invalid periods before generating a file', async () => {
    const { app, excelExportService } = testApp(admin);

    const result = await request(app)
      .post('/api/admin/reports/monthly/2026/13/export')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(excelExportService.calls).toEqual([]);
  });

  it('requires the SuperAdmin role', async () => {
    const { app, excelExportService } = testApp(teacher);

    const result = await request(app)
      .post('/api/admin/reports/monthly/2026/8/export')
      .set('Cookie', 'absensi_session=token');

    expect(result.status).toBe(403);
    expect(excelExportService.calls).toEqual([]);
  });
});
