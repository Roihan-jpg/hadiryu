import { expect, test } from '@playwright/test';
import { MonthlyReportPreviewSchema } from '@absensi/contracts';

import {
  APP_BASE_URL,
  changeInitialPassword,
  expectSuccessfulJsonMutation,
  jakartaDateTime,
  login,
  logout,
  nextJakartaDate,
  requiredEnvironment,
  waitForJakartaMinute,
} from './support/release-helpers';

test('setup sampai ekspor laporan berjalan pada stack lokal', async ({
  context,
  page,
}) => {
  const adminNip = requiredEnvironment('SUPER_ADMIN_NIP');
  const adminInitialPassword = requiredEnvironment(
    'SUPER_ADMIN_INITIAL_PASSWORD',
  );
  const adminPassword = requiredEnvironment('E2E_ADMIN_PASSWORD');
  const teacherNip = requiredEnvironment('E2E_TEACHER_NIP');
  const teacherInitialPassword = requiredEnvironment(
    'E2E_TEACHER_INITIAL_PASSWORD',
  );
  const teacherPassword = requiredEnvironment('E2E_TEACHER_PASSWORD');
  const latitude = Number(requiredEnvironment('E2E_LATITUDE'));
  const longitude = Number(requiredEnvironment('E2E_LONGITUDE'));

  await context.grantPermissions(['geolocation'], { origin: APP_BASE_URL });
  await context.setGeolocation({ latitude, longitude, accuracy: 10 });

  await login(page, adminNip, adminInitialPassword);
  await changeInitialPassword(page, adminInitialPassword, adminPassword);
  await expect(page.getByRole('heading', { name: 'Monitoring kehadiran' })).toBeVisible();

  const attendanceWindow = jakartaDateTime(new Date(Date.now() + 60_000));
  const schedule = {
    checkInOpen: attendanceWindow.time,
    workStart: attendanceWindow.time,
    checkInClose: attendanceWindow.time,
    checkoutOpen: attendanceWindow.time,
    workEnd: attendanceWindow.time,
    checkoutClose: attendanceWindow.time,
    targetMinutes: 1,
  };
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/schedules', {
    effectiveFrom: attendanceWindow.workDate,
    weekday: schedule,
    saturday: schedule,
  });
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/geofence', {
    effectiveFrom: attendanceWindow.workDate,
    latitude,
    longitude,
    radiusMeters: 100,
    maxAccuracyMeters: 50,
  });
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/calendar', {
    workDate: attendanceWindow.workDate,
    exceptionType: 'WORKING_DAY',
    name: 'Smoke test E2E lokal',
    scheduleType: 'WEEKDAY',
  });
  await expectSuccessfulJsonMutation(page, '/api/admin/teachers', {
    nip: teacherNip,
    fullName: 'Guru Smoke E2E',
    initialPassword: teacherInitialPassword,
  });

  await logout(page);
  await login(page, teacherNip, teacherInitialPassword);
  await changeInitialPassword(page, teacherInitialPassword, teacherPassword);
  await expect(page.getByRole('heading', { name: /Hari ini, Guru Smoke E2E/ })).toBeVisible();

  await waitForJakartaMinute(attendanceWindow);
  if (jakartaDateTime().workDate !== attendanceWindow.workDate) {
    await page.reload();
  }
  await page.getByRole('button', { name: 'Check-in sekarang' }).click();
  await expect(page.getByRole('heading', { name: 'Sudah check-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Checkout sekarang' }).click();
  await expect(page.getByRole('heading', { name: 'Absensi selesai' })).toBeVisible();

  const leaveDate = nextJakartaDate(attendanceWindow.workDate);
  await page.getByRole('link', { name: 'Izin', exact: true }).click();
  await page.getByLabel('Tanggal izin').fill(leaveDate);
  await page.getByLabel('Jenis izin').click();
  await page.getByRole('option', { name: 'Dinas Luar' }).click();
  await page.getByLabel('Alasan').fill('Verifikasi release readiness E2E');
  await page.getByRole('button', { name: 'Kirim pengajuan' }).click();
  await expect(
    page.getByText(
      'Pengajuan izin berhasil dikirim dan menunggu keputusan SuperAdmin.',
    ),
  ).toBeVisible();

  await logout(page);
  await login(page, adminNip, adminPassword);
  await page.getByRole('link', { name: 'Approval izin' }).click();
  const request = page.locator('article').filter({ hasText: teacherNip });
  await expect(request).toContainText('Pending');
  await request.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('button', { name: 'Setujui izin' }).click();
  await expect(page.getByText('Izin berhasil disetujui.')).toBeVisible();

  const [year, month] = leaveDate.split('-').map(Number);
  const preview = await page.context().request.get(
    `${APP_BASE_URL}/api/admin/reports/monthly/${year}/${month}/preview`,
  );
  const previewBody = await preview.text();
  expect(preview.ok(), previewBody).toBe(true);
  const parsedPreview = MonthlyReportPreviewSchema.parse(JSON.parse(previewBody));
  expect(parsedPreview.teachers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ teacherNip: teacherNip }),
    ]),
  );

  const exported = await page.context().request.post(
    `${APP_BASE_URL}/api/admin/reports/monthly/${year}/${month}/export`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  );
  const exportBody = await exported.body();
  expect(
    exported.ok(),
    exportBody.toString('utf8', 0, Math.min(exportBody.byteLength, 500)),
  ).toBe(true);
  expect(exported.headers()['content-type']).toContain(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(exportBody.byteLength).toBeGreaterThan(1_000);
});
