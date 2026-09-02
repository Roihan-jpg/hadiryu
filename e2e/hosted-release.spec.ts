import { expect, test, type Page } from '@playwright/test';
import {
  EarlyDepartureRequestListResponseSchema,
  LeaveRequestListResponseSchema,
  MonthlyReportPreviewSchema,
  TodayAttendanceResponseSchema,
} from '@absensi/contracts';

import {
  APP_BASE_URL,
  changeInitialPassword,
  expectSuccessfulGet,
  jakartaDateTime,
  login,
  logout,
  requiredEnvironment,
} from './support/release-helpers';

async function loginAdmin(page: Page): Promise<void> {
  const nip = requiredEnvironment('SUPER_ADMIN_NIP');
  const currentPassword = requiredEnvironment('E2E_ADMIN_PASSWORD');
  const initialPassword = requiredEnvironment('SUPER_ADMIN_INITIAL_PASSWORD');

  await page.goto('/login');
  await page.getByLabel('NIP').fill(nip);
  await page.getByLabel('Password', { exact: true }).fill(currentPassword);
  await page.getByRole('button', { name: 'Masuk' }).click();

  const destination = await Promise.race([
    page.waitForURL((url) => !url.pathname.endsWith('/login')).then(() => true),
    page.getByRole('alert').waitFor().then(() => false),
  ]);
  if (destination) return;

  await page.getByLabel('Password', { exact: true }).fill(initialPassword);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await changeInitialPassword(page, initialPassword, currentPassword);
}

test('smoke hosted sampai ekspor tanpa reset atau seed remote', async ({
  context,
  page,
}) => {
  const teacherNip = requiredEnvironment('E2E_TEACHER_NIP');
  const teacherPassword = requiredEnvironment('E2E_TEACHER_PASSWORD');
  const leaveDate = requiredEnvironment('E2E_LEAVE_DATE');
  const latitude = Number(requiredEnvironment('E2E_LATITUDE'));
  const longitude = Number(requiredEnvironment('E2E_LONGITUDE'));

  expect(
    leaveDate > jakartaDateTime().workDate,
    'E2E_LEAVE_DATE harus berada setelah hari ini di Asia/Jakarta',
  ).toBe(true);
  await context.grantPermissions(['geolocation'], { origin: APP_BASE_URL });
  await context.setGeolocation({ latitude, longitude, accuracy: 10 });

  await login(page, teacherNip, teacherPassword);
  await expect(page).toHaveURL(/\/guru$/);
  const existingEarlyRequests = EarlyDepartureRequestListResponseSchema.parse(
    await expectSuccessfulGet(
      page,
      '/api/early-departure-requests?page=1&pageSize=100',
    ),
  );
  let pendingEarlyDeparture = existingEarlyRequests.data.some(
    (request) =>
      request.workDate === jakartaDateTime().workDate &&
      request.status === 'PENDING',
  );
  const checkIn = page.getByRole('button', { name: 'Check-in sekarang' });
  let today = TodayAttendanceResponseSchema.parse(
    await expectSuccessfulGet(page, '/api/attendance/today'),
  );
  if (today.state === 'READY_TO_CHECK_IN') {
    await expect(checkIn).toBeVisible();
    await checkIn.click();
    await expect(page.getByRole('heading', { name: 'Sudah check-in' })).toBeVisible();
    today = TodayAttendanceResponseSchema.parse(
      await expectSuccessfulGet(page, '/api/attendance/today'),
    );
  }
  if (today.state === 'CHECKED_IN' && today.schedule) {
    const serverMinute = jakartaDateTime(new Date(today.serverNow)).time;
    if (serverMinute < today.schedule.workEnd) {
      await page.getByRole('link', { name: 'Pulang awal', exact: true }).click();
      await page
        .getByLabel('Alasan pulang awal')
        .fill('Verifikasi release readiness hosted');
      await page
        .getByRole('button', { name: 'Kirim permohonan dan catat pulang' })
        .click();
      await expect(
        page.getByText(
          'Permohonan terkirim. Absensi pulang dicatat dan menunggu keputusan admin.',
        ),
      ).toBeVisible();
      pendingEarlyDeparture = true;
    } else if (
      serverMinute >= today.schedule.checkoutOpen &&
      serverMinute <= today.schedule.checkoutClose
    ) {
      await page.getByRole('button', { name: 'Checkout sekarang' }).click();
      await expect(
        page.getByRole('heading', { name: 'Absensi selesai' }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole('heading', { name: 'Sudah check-in' }),
      ).toBeVisible();
    }
  } else {
    await expect(
      page.getByRole('heading', { name: 'Absensi selesai' }),
      'Akun smoke harus memiliki absensi hari ini',
    ).toBeVisible();
  }

  const ownRequests = LeaveRequestListResponseSchema.parse(
    await expectSuccessfulGet(
      page,
      '/api/leave-requests?page=1&pageSize=100',
    ),
  );
  const existingLeave = ownRequests.data.find(
    (request) =>
      request.leaveDate === leaveDate &&
      (request.status === 'PENDING' || request.status === 'APPROVED'),
  );
  if (!existingLeave) {
    await page.getByRole('link', { name: 'Izin', exact: true }).click();
    await page.getByLabel('Tanggal izin').fill(leaveDate);
    await page.getByLabel('Jenis izin').click();
    await page.getByRole('option', { name: 'Dinas Luar' }).click();
    await page
      .getByLabel('Alasan')
      .fill('Verifikasi release readiness hosted');
    await page.getByRole('button', { name: 'Kirim pengajuan' }).click();
    await expect(
      page.getByText(
        'Pengajuan izin berhasil dikirim dan menunggu keputusan SuperAdmin.',
      ),
    ).toBeVisible();
  }

  await logout(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: 'Approval izin' }).click();
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Semua status' }).click();
  await page.getByLabel('Tanggal izin').fill(leaveDate);
  await page.getByRole('button', { name: 'Terapkan filter' }).click();
  const request = page.locator('article').filter({ hasText: teacherNip });
  await expect(request).toBeVisible();
  if (await request.getByRole('button', { name: 'Setujui' }).isVisible()) {
    await request.getByRole('button', { name: 'Setujui' }).click();
    await page.getByRole('button', { name: 'Setujui izin' }).click();
    await expect(page.getByText('Izin berhasil disetujui.')).toBeVisible();
  } else {
    await expect(request).toContainText('Disetujui');
  }

  if (pendingEarlyDeparture) {
    await page.getByRole('link', { name: 'Approval pulang awal' }).click();
    const earlyRequest = page.locator('article').filter({ hasText: teacherNip });
    await expect(earlyRequest).toContainText('Pending');
    page.once('dialog', (dialog) => dialog.accept());
    await earlyRequest.getByRole('button', { name: 'Setujui' }).click();
    await expect(page.getByText('Pulang awal disetujui.')).toBeVisible();
  }

  const [year, month] = leaveDate.split('-').map(Number);
  const preview = await page.context().request.get(
    `${APP_BASE_URL}/api/admin/reports/monthly/${year}/${month}/preview`,
  );
  const previewBody = await preview.text();
  expect(preview.ok(), previewBody).toBe(true);
  const parsedPreview = MonthlyReportPreviewSchema.parse(JSON.parse(previewBody));
  expect(parsedPreview.teachers[0]).not.toHaveProperty('finalPerformancePay');
  expect(parsedPreview.teachers).toEqual(
    expect.arrayContaining([expect.objectContaining({ teacherNip })]),
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
