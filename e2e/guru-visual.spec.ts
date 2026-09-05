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

async function mockGeolocation(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback): void {
          success({
            coords: {
              accuracy: 8,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              latitude: -8.1328,
              longitude: 113.2219,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          });
        },
      },
    });
  });
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

    await expect(page.locator('.teacher-topbar nav')).toHaveCount(0);
    const drawer = page.getByRole('complementary', { name: 'Navigasi Guru' });
    const drawerNavigation = drawer.getByRole('navigation', { name: 'Navigasi Guru' });
    const menuButton = page.getByRole('button', { name: 'Buka menu Guru' });

    if (viewport.width <= 760) {
      await expect(menuButton).toBeVisible();
      await expect(drawer).toBeHidden();
      await menuButton.focus();
      await expect(menuButton).toBeFocused();
      await menuButton.press('Enter');
      await expect(drawer).toBeVisible();
    } else {
      await expect(menuButton).toBeHidden();
      await expect(drawer).toBeVisible();
    }

    await expect(drawerNavigation).toHaveCSS('display', 'grid');
    await expect(drawer.getByRole('link', { name: 'Izin', exact: true })).toBeVisible();

    const firstLink = await drawerNavigation.getByRole('link').nth(0).boundingBox();
    const secondLink = await drawerNavigation.getByRole('link').nth(1).boundingBox();
    expect(firstLink).not.toBeNull();
    expect(secondLink).not.toBeNull();
    expect(secondLink!.y).toBeGreaterThanOrEqual(firstLink!.y + firstLink!.height);
  });
}

test('open Guru drawer stays above the Leaflet map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGeolocation(page);
  await mockTeacherApi(page);
  await page.goto('/guru');

  await page.getByRole('button', { name: 'Tampilkan lokasi saya' }).click();
  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible();

  await page.getByRole('button', { name: 'Buka menu Guru' }).click();
  const drawer = page.getByRole('complementary', { name: 'Navigasi Guru' });
  await expect(drawer).toBeVisible();

  const overlapIsCoveredByDrawer = await page.evaluate(() => {
    const mapElement = document.querySelector<HTMLElement>('.leaflet-container');
    const drawerElement = document.querySelector<HTMLElement>('.teacher-drawer');
    if (!mapElement || !drawerElement) return false;

    const mapRect = mapElement.getBoundingClientRect();
    const drawerRect = drawerElement.getBoundingClientRect();
    const x = Math.max(mapRect.left, drawerRect.left) + 24;
    const y = Math.max(mapRect.top, drawerRect.top) + 24;
    return document.elementFromPoint(x, y)?.closest('.teacher-drawer') === drawerElement;
  });

  expect(overlapIsCoveredByDrawer).toBe(true);
});
