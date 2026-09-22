import { expect, test } from '@playwright/test';

const firstLoginTeacher = {
  id: '50000000-0000-4000-8000-000000000091',
  nip: '1987091',
  fullName: 'Guru Brand',
  role: 'USER',
  isActive: true,
  mustChangePassword: true,
};

test('login uses the correct official logo on dark and light surfaces', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 401, json: {
    error: { code: 'UNAUTHENTICATED', message: 'Sesi tidak tersedia' },
  } }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await expect(page.locator('.opening-screen')).toHaveCount(0);
  const desktopLogo = page.locator('.login-context .brand-logo');
  await expect(desktopLogo).toBeVisible();
  await expect(desktopLogo).toHaveAttribute('src', '/assets/brand/hadiryu-on-dark.png');
  expect(await desktopLogo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(720);
  await page.screenshot({ path: 'test-results/brand-login-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLogo = page.locator('.mobile-brand .brand-logo');
  await expect(mobileLogo).toBeVisible();
  await expect(mobileLogo).toHaveAttribute('src', '/assets/brand/hadiryu-on-light.png');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/brand-login-mobile.png', fullPage: true });
});

test('change-password uses the dark-surface logo and keeps the user initial', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: firstLoginTeacher } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/change-password');

  const logo = page.locator('.school-brand .brand-logo');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', '/assets/brand/hadiryu-on-dark.png');
  await expect(page.locator('.account-summary > span')).toHaveText('G');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.ico');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
