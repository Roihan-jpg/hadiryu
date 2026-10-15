import { expect, test } from '@playwright/test';
import {
  AdminDashboardResponseSchema,
  GeofenceSettingsResponseSchema,
  GeofenceTemplateSchema,
  MonthlyReportPreviewSchema,
  PasswordResetResponseSchema,
  TeacherResponseSchema,
  TodayAttendanceResponseSchema,
} from '@absensi/contracts';

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

test.setTimeout(180_000);

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
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

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
  const geofenceTemplate = GeofenceTemplateSchema.parse(await expectSuccessfulJsonMutation(page, '/api/admin/settings/geofence-templates', {
    name: 'Zona Smoke E2E',
    shape: 'POLYGON',
    vertices: [
      { latitude: latitude - 0.0003, longitude: longitude - 0.0003 },
      { latitude: latitude - 0.0003, longitude: longitude + 0.0003 },
      { latitude: latitude + 0.0003, longitude: longitude + 0.0003 },
      { latitude: latitude + 0.0003, longitude: longitude - 0.0003 },
    ],
    maxAccuracyMeters: 15,
  }));
  const activeGeofence = GeofenceSettingsResponseSchema.parse(await expectSuccessfulJsonMutation(
    page,
    '/api/admin/settings/geofence/activate',
    { templateId: geofenceTemplate.id },
  ));
  expect(activeGeofence.geofence).toMatchObject({ templateId: geofenceTemplate.id, shape: 'POLYGON' });
  await expectSuccessfulJsonMutation(page, '/api/admin/settings/calendar', {
    workDate: attendanceWindow.workDate,
    exceptionType: 'WORKING_DAY',
    name: 'Smoke test E2E lokal',
    scheduleType: 'WEEKDAY',
  });
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto(`${APP_BASE_URL}/admin/settings`);
  await page.getByRole('tab', { name: 'Geofence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Template geofence' })).toBeVisible();
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Zona Smoke E2E' }) }).getByRole('button', { name: 'Ubah' }).click();
  await expect(page.locator('app-admin-geofence-map')).toBeVisible();
  await expect(page.getByText('4 titik batas', { exact: true })).toBeVisible();
  await page.locator('app-admin-geofence-map .map-host').click({
    position: { x: 120, y: 120 },
  });
  await expect(page.getByText('5 titik batas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Urungkan titik' }).click();
  await expect(page.getByText('4 titik batas', { exact: true })).toBeVisible();
  const teacher = TeacherResponseSchema.parse(await expectSuccessfulJsonMutation(page, '/api/admin/teachers', {
    nip: teacherNip,
    fullName: 'Guru Smoke E2E',
    initialPassword: teacherInitialPassword,
    whatsappNumber: '+6281234567801',
    gender: 'FEMALE',
  }));
  await expectSuccessfulJsonMutation(page, '/api/admin/teachers', {
    nip: earlyTeacherNip,
    fullName: 'Guru Pulang Awal E2E',
    initialPassword: earlyTeacherInitialPassword,
    whatsappNumber: '+6281234567802',
    gender: 'MALE',
  });
  const reset = PasswordResetResponseSchema.parse(await expectSuccessfulJsonMutation(
    page,
    `/api/admin/teachers/${teacher.teacher.id}/reset-password`,
    {},
  ));
  await logout(page);
  await login(page, teacherNip, reset.newPassword);
  await page.getByRole('link', { name: 'Absen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Belum Absen Masuk' })).toBeVisible();
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
  await earlyPage.getByRole('link', { name: 'Absen', exact: true }).click();
  await expect(
    earlyPage.getByRole('heading', { name: 'Belum Absen Masuk' }),
  ).toBeVisible();

  await waitForJakartaMinute(attendanceWindow);
  if (jakartaDateTime().workDate !== attendanceWindow.workDate) {
    await Promise.all([page.reload(), earlyPage.reload()]);
  }
  await Promise.all([
    page.getByRole('button', { name: 'Absen Masuk sekarang' }).click(),
    earlyPage.getByRole('button', { name: 'Absen Masuk sekarang' }).click(),
  ]);
  await Promise.all([
    expect(page.getByRole('heading', { name: 'Absen Masuk tercatat' })).toBeVisible(),
    expect(
      earlyPage.getByRole('heading', { name: 'Absen Masuk tercatat' }),
    ).toBeVisible(),
  ]);
  await page.getByRole('button', { name: 'Absen Pulang sekarang' }).click();
  await expect(page.getByRole('heading', { name: 'Absensi selesai' })).toBeVisible();
  await test.step('enrollment nonaktif tidak mengubah absensi',async()=>{
    const before=await page.context().request.get(`${APP_BASE_URL}/api/attendance/today`);
    const beforeBody=TodayAttendanceResponseSchema.parse(await before.json());
    const status=await page.context().request.get(`${APP_BASE_URL}/api/face/enrollment/status`);
    expect(status.status()).toBe(409);
    expect((await status.json()).error.code).toBe('ENROLLMENT_UNAVAILABLE');
    await page.goto(`${APP_BASE_URL}/guru/face-enrollment`);
    await expect(page.getByRole('heading',{name:'Pendaftaran wajah',exact:true})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Enrollment hanya tersedia');
    const after=await page.context().request.get(`${APP_BASE_URL}/api/attendance/today`);
    const afterBody=TodayAttendanceResponseSchema.parse(await after.json());
    expect(afterBody.attendance).toEqual(beforeBody.attendance);
    expect(afterBody.state).toBe(beforeBody.state);
    expect(afterBody.workDate).toBe(beforeBody.workDate);
    await page.goto(`${APP_BASE_URL}/guru/absen`);
    await expect(page.getByRole('heading',{name:'Absensi selesai'})).toBeVisible();
  });

  await earlyPage.getByRole('link', { name: 'Pulang awal', exact: true }).click();
  await earlyPage.getByLabel('Alasan pulang awal').fill('Keperluan keluarga untuk smoke E2E');
  await earlyPage.getByLabel(/Lampiran opsional/).setInputFiles({
    name: 'bukti-pulang-awal.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nE2E'),
  });
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
  await page.getByLabel(/Lampiran pendukung/).setInputFiles({
    name: 'bukti-izin.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nE2E'),
  });
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
  const request = page.getByRole('row').filter({
    has: page.getByText(teacherNip, { exact: true }),
  });
  await expect(request).toContainText('Pending');
  await request.getByRole('link', { name: 'Lihat detail' }).click();
  await expect(page.getByRole('link', { name: 'Hubungi via WhatsApp' })).toHaveAttribute(
    'href',
    'https://wa.me/6281234567801',
  );
  await expect(page.getByRole('link', { name: /Unduh bukti-izin\.pdf/ })).toBeVisible();
  await page.getByRole('button', { name: 'Setujui izin' }).click();
  await expect(page.getByText('Disetujui', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Approval pulang awal' }).click();
  const earlyRequest = page.getByRole('row').filter({
    has: page.getByText(earlyTeacherNip, { exact: true }),
  });
  await expect(earlyRequest).toContainText('Pending');
  await earlyRequest.getByRole('link', { name: 'Lihat detail' }).click();
  await expect(page.getByRole('heading', { name: 'Timeline absensi' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Unduh bukti-pulang-awal\.pdf/ })).toBeVisible();
  await page.getByRole('button', { name: 'Setujui', exact: true }).click();
  await expect(page.getByText('Disetujui', { exact: true })).toBeVisible();

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

  await page.getByRole('link', { name: 'Laporan', exact: true }).click();
  const dashboardResponse = await page.context().request.get(`${APP_BASE_URL}/api/admin/dashboard`);
  expect(dashboardResponse.ok()).toBe(true);
  const dashboard = AdminDashboardResponseSchema.parse(await dashboardResponse.json());
  expect(dashboard.trend).toHaveLength(7);
  expect(dashboard.day.arrived).toBeGreaterThanOrEqual(1);
  expect(dashboard.arrivals.at(-1)?.cumulative).toBe(dashboard.day.arrived);
  await expect(page.getByRole('heading', { name: 'Laporan Absensi' })).toBeVisible();
  await page.getByRole('link', { name: 'Audit Log', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
  await expect(page.getByText('TEACHER_PASSWORD_RESET', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Panduan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Panduan Super Admin' })).toBeVisible();
});
