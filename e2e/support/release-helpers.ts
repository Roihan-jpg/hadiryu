import { expect, type Page } from '@playwright/test';

export const APP_BASE_URL = 'http://127.0.0.1:4200';
const MUTATION_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

export interface JakartaDateTime {
  workDate: string;
  time: string;
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib tersedia untuk E2E`);
  return value;
}

export function jakartaDateTime(date = new Date()): JakartaDateTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    workDate: `${parts['year']}-${parts['month']}-${parts['day']}`,
    time: `${parts['hour']}:${parts['minute']}`,
  };
}

export function nextJakartaDate(workDate: string): string {
  const date = new Date(`${workDate}T00:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return jakartaDateTime(date).workDate;
}

export async function login(
  page: Page,
  nip: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('NIP').fill(nip);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

export async function changeInitialPassword(
  page: Page,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (!/\/change-password$/.test(page.url())) {
    await page.goto('/change-password');
  }
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Password saat ini', { exact: true }).fill(currentPassword);
  await page.getByLabel('Password baru', { exact: true }).fill(newPassword);
  await page.getByLabel('Ulangi password baru', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: 'Simpan password baru' }).click();
  await expect(page).not.toHaveURL(/\/change-password$/);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Keluar/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function expectSuccessfulJsonMutation(
  page: Page,
  path: string,
  data: unknown,
): Promise<unknown> {
  const response = await page.context().request.post(`${APP_BASE_URL}${path}`, {
    data,
    headers: MUTATION_HEADERS,
  });
  const body = await response.text();
  expect(response.ok(), `${path}: ${response.status()} ${body}`).toBe(true);
  return body ? JSON.parse(body) : null;
}

export async function expectSuccessfulGet(
  page: Page,
  path: string,
): Promise<unknown> {
  const response = await page.context().request.get(`${APP_BASE_URL}${path}`);
  const body = await response.text();
  expect(response.ok(), `${path}: ${response.status()} ${body}`).toBe(true);
  return body ? JSON.parse(body) : null;
}

export async function waitForJakartaMinute(
  expected: JakartaDateTime,
): Promise<void> {
  await expect
    .poll(() => jakartaDateTime(), {
      message: `Menunggu window absensi ${expected.workDate} ${expected.time} WIB`,
      timeout: 70_000,
      intervals: [500],
    })
    .toEqual(expected);
}
