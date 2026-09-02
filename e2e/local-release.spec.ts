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
  browser,
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
  const earlyTeacherNip = requiredEnvironment('E2E_EARLY_TEACHER_NIP');
  const earlyTeacherInitialPassword = requiredEnvironment(
    'E2E_EARLY_TEACHER_INITIAL_PASSWORD',
  );
  const earlyTeacherPassword = requiredEnvironment(
    'E2E_EARLY_TEACHER_PASSWORD',
  );
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
    workEnd: '23:59',
    checkoutClose: '23:59',
    targetMinutes: 1,
  };
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/schedules', {
    weekday: schedule,
    saturday: schedule,
  });
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/geofence', {
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
  await expectSuccessfulJsonMutation(page, '/api/admin/teachers', {
    nip: earlyTeacherNip,
    fullName: 'Guru Pulang Awal E2E',
    initialPassword: earlyTeacherInitialPassword,
  });

  await logout(page);
  await login(page, teacherNip, teacherInitialPassword);
  await changeInitialPassword(page, teacherInitialPassword, teacherPassword);
  await expect(page.getByRole('heading', { name: /Hari ini, Guru Smoke E2E/ })).toBeVisible();
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await expect(page.locator('app-teacher-location-map')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tampilkan lokasi saya' }).click();
  await expect(page.locator('app-teacher-location-map')).toBeVisible();
  await expect(page.getByText(latitude.toFixed(6), { exact: true })).toBeVisible();
  await expect(page.getByText(longitude.toFixed(6), { exact: true })).toBeVisible();
  await expect(page.getByText('10 meter', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perbarui lokasi' })).toBeVisible();

  const earlyContext = await browser.newContext({
    baseURL: APP_BASE_URL,
    geolocation: { latitude, longitude, accuracy: 10 },
    permissions: ['geolocation'],
  });
  const earlyPage = await earlyContext.newPage();
  await login(earlyPage, earlyTeacherNip, earlyTeacherInitialPassword);
  await changeInitialPassword(
    earlyPage,
    earlyTeacherInitialPassword,
    earlyTeacherPassword,
  );
  await expect(
    earlyPage.getByRole('heading', { name: /Hari ini, Guru Pulang Awal E2E/ }),
  ).toBeVisible();

  await waitForJakartaMinute(attendanceWindow);
  if (jakartaDateTime().workDate !== attendanceWindow.workDate) {
    await Promise.all([page.reload(), earlyPage.reload()]);
  }
  await Promise.all([
    page.getByRole('button', { name: 'Check-in sekarang' }).click(),
    earlyPage.getByRole('button', { name: 'Check-in sekarang' }).click(),
  ]);
  await Promise.all([
    expect(page.getByRole('heading', { name: 'Sudah check-in' })).toBeVisible(),
    expect(
      earlyPage.getByRole('heading', { name: 'Sudah check-in' }),
    ).toBeVisible(),
  ]);
  await page.getByRole('button', { name: 'Checkout sekarang' }).click();
  await expect(page.getByRole('heading', { name: 'Absensi selesai' })).toBeVisible();

  await earlyPage.getByRole('link', { name: 'Pulang awal', exact: true }).click();
  await earlyPage.getByLabel('Alasan pulang awal').fill('Keperluan keluarga untuk smoke E2E');
  await earlyPage
    .getByRole('button', { name: 'Kirim permohonan dan catat pulang' })
    .click();
  await expect(
    earlyPage.getByText(
      'Permohonan terkirim. Absensi pulang dicatat dan menunggu keputusan admin.',
    ),
  ).toBeVisible();

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

  await logout(earlyPage);
  await earlyContext.close();
  await logout(page);
  await login(page, adminNip, adminPassword);
  await page.getByRole('link', { name: 'Approval izin' }).click();
  const request = page.locator('article').filter({ hasText: teacherNip });
  await expect(request).toContainText('Pending');
  await request.getByRole('button', { name: 'Setujui' }).click();
  await page.getByRole('button', { name: 'Setujui izin' }).click();
  await expect(page.getByText('Izin berhasil disetujui.')).toBeVisible();

  await page.getByRole('link', { name: 'Approval pulang awal' }).click();
  const earlyRequest = page.locator('article').filter({ hasText: earlyTeacherNip });
  await expect(earlyRequest).toContainText('Pending');
  page.once('dialog', (dialog) => dialog.accept());
  await earlyRequest.getByRole('button', { name: 'Setujui' }).click();
  await expect(page.getByText('Pulang awal disetujui.')).toBeVisible();

  const [attendanceYear, attendanceMonth] = attendanceWindow.workDate
    .split('-')
    .map(Number);
  const attendancePreview = await page.context().request.get(
    `${APP_BASE_URL}/api/admin/reports/monthly/${attendanceYear}/${attendanceMonth}/preview`,
  );
  const attendancePreviewBody = await attendancePreview.text();
  expect(attendancePreview.ok(), attendancePreviewBody).toBe(true);
  const parsedAttendancePreview = MonthlyReportPreviewSchema.parse(
    JSON.parse(attendancePreviewBody),
  );
  expect(parsedAttendancePreview.teachers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        teacherNip: earlyTeacherNip,
        rejectedEarlyDepartureMinutes: 0,
      }),
    ]),
  );
  expect(parsedAttendancePreview.teachers[0]).not.toHaveProperty(
    'finalPerformancePay',
  );

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
