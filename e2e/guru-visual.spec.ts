import { expect, test } from '@playwright/test';

const teacher = {
  id: '50000000-0000-4000-8000-000000000007',
  nip: '1987007',
  fullName: 'Guru Tujuh',
  whatsappNumber: '+628123456789',
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
    const state = window as typeof window & { __geolocationWatchCalls: number };
    state.__geolocationWatchCalls = 0;
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
        watchPosition(success: PositionCallback): number {
          state.__geolocationWatchCalls += 1;
          const watchId = state.__geolocationWatchCalls;
          window.setTimeout(() => {
            success({
              coords: {
                accuracy: 45,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                latitude: -8.1329,
                longitude: 113.222,
                speed: null,
                toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            });
            window.setTimeout(() => success({
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
            }), 10);
          }, 0);
          return watchId;
        },
        clearWatch(): void {
          // Scheduled callbacks are harmless after the accepted sample settles.
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
    await expect(page.getByText('WhatsApp +628123456789')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check-in sekarang' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await expect(page.locator('.teacher-topbar nav')).toHaveCount(0);
    const drawer = page.getByRole('complementary', { name: 'Navigasi Guru' });
    const drawerNavigation = drawer.getByRole('navigation', { name: 'Navigasi Guru' });
    const menuButton = page.getByRole('button', { name: 'Buka menu Guru' });

    if (viewport.width <= 760) {
      const mobileHeader = page.locator('.app-mobile-header');
      await expect(mobileHeader).toBeVisible();
      await expect(mobileHeader.getByRole('link', { name: 'SD Islam Tompokersan, halaman utama' })).toBeVisible();
      await expect(mobileHeader.getByRole('link', { name: 'Buka profil Guru Tujuh' })).toBeVisible();
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

test('Guru check-in reuses the ready preview without starting another GPS watch', async ({ page }) => {
  let submittedLocation: unknown;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockGeolocation(page);
  await mockTeacherApi(page);
  await page.route('**/api/attendance/check-in', async (route) => {
    submittedLocation = route.request().postDataJSON();
    await route.fulfill({
      json: {
        id: '40000000-0000-4000-8000-000000000007',
        workDate: today.workDate,
        checkInAt: '2026-09-05T00:05:00.000Z',
        latitude: -8.1328,
        longitude: 113.2219,
        accuracyMeters: 8,
        distanceMeters: 0,
        workStart: today.schedule.workStart,
        workEnd: today.schedule.workEnd,
        checkoutClose: today.schedule.checkoutClose,
        targetMinutes: today.schedule.targetMinutes,
        arrivalLateMinutes: 5,
        status: 'CHECKED_IN',
      },
    });
  });
  await page.goto('/guru');

  await page.getByRole('button', { name: 'Tampilkan lokasi saya' }).click();
  await expect(page.getByText('Siap digunakan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check-in sekarang' }).click();

  await expect(page.getByText(/Check-in berhasil dicatat/)).toBeVisible();
  expect(submittedLocation).toEqual({
    latitude: -8.1328,
    longitude: 113.2219,
    accuracyMeters: 8,
  });
  expect(await page.evaluate(() => (
    window as typeof window & { __geolocationWatchCalls: number }
  ).__geolocationWatchCalls)).toBe(1);
});

test('Guru dashboard uses a circular profile avatar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTeacherApi(page);
  await page.goto('/guru');

  const avatar = page.locator('.identity-avatar');
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveCSS('border-radius', '50%');
  const bounds = await avatar.boundingBox();
  expect(bounds?.width).toBe(bounds?.height);
});

test('Guru desktop pages keep a 64px gutter inside the expanded sidebar workspace', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await mockTeacherApi(page);

  for (const [path, selector] of [
    ['/guru', '.teacher-page'],
    ['/guru/riwayat', '.teacher-page'],
    ['/guru/izin', '.teacher-page'],
    ['/guru/pulang-awal', '.teacher-page'],
    ['/profile', '.profile-page'],
  ]) {
    await page.goto(path);

    const gutter = await page.locator(selector).evaluate((element) => {
      const content = element.getBoundingClientRect();
      const workspace = document.querySelector<HTMLElement>('.teacher-main')?.getBoundingClientRect();
      if (!workspace) return null;

      return {
        left: content.left - workspace.left,
        right: workspace.right - content.right,
      };
    });

    expect(gutter).not.toBeNull();
    expect(gutter!.left).toBe(64);
    expect(gutter!.right).toBe(64);
  }
});

test('Guru dashboard starts the desktop gutter at 1024px and keeps the previous compact width below it', async ({ page }) => {
  await mockTeacherApi(page);

  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/guru');

    const gutter = await page.locator('.teacher-page').evaluate((element) => {
      const content = element.getBoundingClientRect();
      const workspace = document.querySelector<HTMLElement>('.teacher-main')?.getBoundingClientRect();
      if (!workspace) return null;
      return content.left - workspace.left;
    });

    expect(gutter).toBe(64);
  }

  await page.setViewportSize({ width: 1023, height: 900 });
  await page.goto('/guru');
  const compactGutter = await page.locator('.teacher-page').evaluate((element) => {
    const content = element.getBoundingClientRect();
    const workspace = document.querySelector<HTMLElement>('.teacher-main')?.getBoundingClientRect();
    if (!workspace) return null;
    return content.left - workspace.left;
  });

  expect(compactGutter).toBe(16);
});
