import { expect, test } from '@playwright/test';

const admin = {
  id: '50000000-0000-4000-8000-000000000001',
  nip: 'admin-001',
  fullName: 'Admin Sekolah',
  role: 'SUPER_ADMIN',
  isActive: true,
  mustChangePassword: false,
};

const records = [
  ['PRESENT', 'Guru Aminah', '1987001'],
  ['LATE', 'Guru Budi', '1987002'],
  ['NOT_PRESENT', 'Guru Citra', '1987003'],
  ['INCOMPLETE', 'Guru Damar', '1987004'],
  ['LEAVE', 'Guru Eka', '1987005'],
] as const;

async function mockAdminApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: admin } }));
  const day = { workDate: '2026-09-04', state: 'WORKING', description: 'Jadwal kerja Guru', provisional: true, scheduled: 5, arrived: 3, notCheckedIn: 1, leave: 1, late: 1 };
  await page.route('**/api/admin/dashboard**', (route) => route.fulfill({ json: {
    workDate: day.workDate, generatedAt: '2026-09-04T01:00:00Z', day,
    window: { openAt:'2026-09-03T23:00:00Z', startAt:'2026-09-04T00:00:00Z', closeAt:'2026-09-04T02:00:00Z', observedUntil:'2026-09-04T01:00:00Z' },
    arrivals: [{ at:'2026-09-03T23:25:00Z', count:1, cumulative:1 }, { at:'2026-09-03T23:50:00Z', count:1, cumulative:2 }, { at:'2026-09-04T00:08:00Z', count:1, cumulative:3 }],
    trend: [3,4,0,4,5,4,3].map((arrived,index) => ({ ...day, workDate: new Date(Date.UTC(2026,7,29+index)).toISOString().slice(0,10), arrived, provisional:index === 6 })),
    guards: [
      { teacherId:'50000000-0000-4000-8000-000000000081', name:'Ahmad Fauzi', assignment:'DAY', status:'Sudah check-in', startAt:'2026-09-03T23:00:00Z', endAt:'2026-09-04T11:00:00Z' },
      { teacherId:'50000000-0000-4000-8000-000000000082', name:'Bambang Suharto', assignment:'NIGHT', status:'Belum waktunya bertugas', startAt:'2026-09-04T11:00:00Z', endAt:'2026-09-04T23:00:00Z' },
      { teacherId:'50000000-0000-4000-8000-000000000083', name:'Dedi Santoso', assignment:'OFF', status:'Libur rotasi', startAt:null, endAt:null },
    ], rosterAvailable:true,
  } }));
  await page.route('**/api/admin/leave-requests**', (route) => route.fulfill({ json: { data:[], pagination:{ page:1, pageSize:3, totalItems:0, totalPages:0 } } }));
  await page.route('**/api/admin/early-departure-requests**', (route) => route.fulfill({ json: { data:[], pagination:{ page:1, pageSize:3, totalItems:0, totalPages:0 } } }));
  await page.route('**/api/admin/attendance**', (route) => route.fulfill({
    json: {
      summary: { workDate: '2026-09-04', generatedAt: '2026-09-04T01:00:00.000Z', present: 1, late: 1, notPresent: 1, incomplete: 1, leave: 1, off: 0, total: 5 },
      data: records.map(([status, teacherFullName, teacherNip], index) => ({
        teacherId: `50000000-0000-4000-8000-00000000000${index + 2}`,
        teacherNip, teacherFullName, workDate: '2026-09-04', status,
        attendanceId: status === 'NOT_PRESENT' || status === 'LEAVE' ? null : `40000000-0000-4000-8000-00000000000${index + 1}`,
        checkInAt: status === 'NOT_PRESENT' || status === 'LEAVE' ? null : '2026-09-04T00:01:00.000Z',
        checkOutAt: status === 'PRESENT' ? '2026-09-04T08:35:00.000Z' : null,
        workedMinutes: status === 'PRESENT' ? 514 : null,
        workDeficitMinutes: status === 'PRESENT' ? 1 : null,
        arrivalLateMinutes: status === 'LATE' ? 8 : status === 'PRESENT' ? 1 : null,
        leaveType: status === 'LEAVE' ? 'SICK' : null,
        notes: [],
      })),
      pagination: { page: 1, pageSize: 20, totalItems: 5, totalPages: 1 },
    },
  }));
}

async function mockTeachersApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: admin } }));
  await page.route('**/api/admin/teachers**', (route) => route.fulfill({
    json: {
      data: [
        {
          id: '50000000-0000-4000-8000-000000000010',
          nip: '19870001',
          fullName: 'Guru Aminah',
          whatsappNumber: '+628123456789',
          role: 'USER',
          isActive: true,
          mustChangePassword: false,
          temporaryPasswordExpiresAt: null,
          createdAt: '2026-09-04T01:00:00.000Z',
          updatedAt: '2026-09-04T01:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    },
  }));
}

for (const viewport of [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
]) {
  test(`admin shell has no viewport overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockAdminApi(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ritme kedatangan Guru' })).toBeVisible();
    await expect(page.locator('.arrival-line')).toBeVisible();
    const point = page.locator('app-arrival-chart g').first();
    await point.focus();
    await point.press('Enter');
    await expect(page.locator('.readout')).toContainText('06.25 WIB');
    await page.locator('#dashboard-title').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/dashboard-${viewport.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (viewport.width <= 760) {
      const header = page.locator('.app-mobile-header');
      const menuButton = page.getByRole('button', { name: 'Buka menu Super Admin' });
      await expect(header).toBeVisible();
      await expect(header.getByRole('link', { name: 'SD Islam Tompokersan, halaman utama' })).toBeVisible();
      await expect(header.getByRole('link', { name: 'Buka profil Admin Sekolah' })).toBeVisible();
      await expect(menuButton).toBeVisible();
      await menuButton.focus();
      await expect(menuButton).toBeFocused();
      await menuButton.press('Enter');
      await expect(page.getByRole('complementary', { name: 'Navigasi Super Admin' })).toBeVisible();
    } else {
      await expect(page.getByRole('region', { name: 'Akun aktif' })).toBeVisible();
      await expect(page.getByText('Admin Sekolah', { exact: true })).toBeVisible();
    }
  });
}

test('master akun keeps identity and actions visible without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTeachersApi(page);
  await page.goto('/admin/teachers');

  const accountCard = page.locator('.mobile-account-card');
  await expect(accountCard).toBeVisible();
  await expect(accountCard.getByText('Guru Aminah')).toBeVisible();
  await expect(accountCard.getByText('19870001')).toBeVisible();
  await expect(accountCard.getByRole('button', { name: 'Reset password' })).toBeVisible();
  await expect(page.locator('.table-frame table')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

