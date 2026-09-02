import { expect, test, type Page } from '@playwright/test';
import {
  GeofenceSettingsResponseSchema,
  ScheduleSettingsResponseSchema,
  TeacherListResponseSchema,
} from '@absensi/contracts';

import {
  changeInitialPassword,
  expectSuccessfulGet,
  expectSuccessfulJsonMutation,
  jakartaDateTime,
  login,
  logout,
  requiredEnvironment,
} from './support/release-helpers';

async function loginWithInitialFallback(
  page: Page,
  nip: string,
  initialPassword: string,
  finalPassword: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('NIP').fill(nip);
  await page.getByLabel('Password', { exact: true }).fill(finalPassword);
  await page.getByRole('button', { name: 'Masuk' }).click();
  const finalPasswordWorked = await Promise.race([
    page.waitForURL((url) => !url.pathname.endsWith('/login')).then(() => true),
    page.getByRole('alert').waitFor().then(() => false),
  ]);
  if (finalPasswordWorked) return;

  await login(page, nip, initialPassword);
  await changeInitialPassword(page, initialPassword, finalPassword);
}

test('siapkan konfigurasi dan akun smoke hosted tanpa menimpa data', async ({
  page,
}) => {
  const adminNip = requiredEnvironment('SUPER_ADMIN_NIP');
  const adminInitialPassword = requiredEnvironment('SUPER_ADMIN_INITIAL_PASSWORD');
  const adminPassword = requiredEnvironment('E2E_ADMIN_PASSWORD');
  const teacherNip = requiredEnvironment('E2E_TEACHER_NIP');
  const teacherInitialPassword = requiredEnvironment('E2E_TEACHER_INITIAL_PASSWORD');
  const teacherPassword = requiredEnvironment('E2E_TEACHER_PASSWORD');
  const latitude = Number(requiredEnvironment('E2E_LATITUDE'));
  const longitude = Number(requiredEnvironment('E2E_LONGITUDE'));
  const effectiveFrom = jakartaDateTime().workDate;

  await loginWithInitialFallback(
    page,
    adminNip,
    adminInitialPassword,
    adminPassword,
  );
  await expect(page).toHaveURL(/\/admin$/);

  const expectedWeekday = {
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '12:00',
    workEnd: '15:35',
    checkoutClose: '17:00',
    targetMinutes: 515,
  };
  const expectedSaturday = {
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '09:30',
    workEnd: '10:35',
    checkoutClose: '12:00',
    targetMinutes: 215,
  };
  let schedules = ScheduleSettingsResponseSchema.parse(
    await expectSuccessfulGet(
      page,
      `/api/admin/settings/schedules?effectiveOn=${effectiveFrom}`,
    ),
  );
  if (!schedules.weekday && !schedules.saturday) {
    schedules = ScheduleSettingsResponseSchema.parse(
      await expectSuccessfulJsonMutation(page, '/api/admin/settings/schedules', {
        weekday: expectedWeekday,
        saturday: expectedSaturday,
      }),
    );
  }
  expect(schedules.weekday).toMatchObject({
    scheduleType: 'WEEKDAY',
    targetMinutes: expectedWeekday.targetMinutes,
  });
  expect(schedules.saturday).toMatchObject({
    scheduleType: 'SATURDAY',
    targetMinutes: expectedSaturday.targetMinutes,
  });

  let geofence = GeofenceSettingsResponseSchema.parse(
    await expectSuccessfulGet(
      page,
      `/api/admin/settings/geofence?effectiveOn=${effectiveFrom}`,
    ),
  );
  if (!geofence.geofence) {
    geofence = GeofenceSettingsResponseSchema.parse(
      await expectSuccessfulJsonMutation(page, '/api/admin/settings/geofence', {
        latitude,
        longitude,
        radiusMeters: 100,
        maxAccuracyMeters: 50,
      }),
    );
  }
  expect(geofence.geofence).toMatchObject({
    latitude,
    longitude,
    radiusMeters: 100,
    maxAccuracyMeters: 50,
  });

  const teachers = TeacherListResponseSchema.parse(
    await expectSuccessfulGet(
      page,
      `/api/admin/teachers?search=${encodeURIComponent(teacherNip)}&page=1&pageSize=10`,
    ),
  );
  const existingTeacher = teachers.data.find(
    (teacher) => teacher.nip === teacherNip,
  );
  if (!existingTeacher) {
    await expectSuccessfulJsonMutation(page, '/api/admin/teachers', {
      nip: teacherNip,
      fullName: 'Guru Smoke T15',
      initialPassword: teacherInitialPassword,
    });
  } else {
    expect(existingTeacher.isActive, 'Akun Guru smoke harus aktif').toBe(true);
  }

  await logout(page);
  await loginWithInitialFallback(
    page,
    teacherNip,
    teacherInitialPassword,
    teacherPassword,
  );
  await expect(page).toHaveURL(/\/guru$/);
});
