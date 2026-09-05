import { expect, test } from '@playwright/test';

const teacher = {
  id: '50000000-0000-4000-8000-000000000007',
  nip: '1987007',
  fullName: 'Guru Tujuh',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

const today = {
  serverNow: '2026-09-05T00:00:00.000Z',
  workDate: '2026-09-05',
  state: 'READY_TO_CHECK_IN',
  schedule: {
    scheduleType: 'SATURDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '11:00',
    workEnd: '12:00',
    checkoutClose: '13:00',
    targetMinutes: 300,
  },
  attendance: null,
  locationRequirement: { maxAccuracyMeters: 15 },
};

async function mockTeacherApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: teacher } }));
  await page.route('**/api/attendance/today', (route) => route.fulfill({ json: today }));
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
}

for (const viewport of [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'mobile-390', width: 390, height: 844 },
]) {
  test(`Guru journey has no viewport overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockTeacherApi(page);
    await page.goto('/guru');

    await expect(page.getByRole('heading', { name: 'Hari ini, Guru Tujuh' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check-in sekarang' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (viewport.width <= 760) {
      const menuButton = page.getByRole('button', { name: 'Buka menu Guru' });
      await expect(menuButton).toBeVisible();
      await menuButton.focus();
      await expect(menuButton).toBeFocused();
      await menuButton.press('Enter');
      const drawer = page.getByRole('complementary', { name: 'Navigasi Guru' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Izin', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Navigasi utama Guru' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Buka Profil Saya' })).toBeVisible();
    }
  });
}
