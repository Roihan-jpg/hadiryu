import { expect, test } from '@playwright/test';
import type { AuthUser } from '@absensi/contracts';

// Declared camera-state fixture: exercises layout without a person's camera or face.
async function showCamera(page: import('@playwright/test').Page, selector: string, state: string) {
  await page.evaluate(({ selector, state }) => {
    const debug = (window as unknown as { ng: {
      getComponent: (element: Element) => { state: { set: (value: string) => void } };
      applyChanges: (component: unknown) => void;
    } }).ng;
    const component = debug.getComponent(document.querySelector(selector)!);
    component.state.set(state);debug.applyChanges(component);
  }, { selector, state });
  await expect(page.locator('img.face-frame')).toHaveCount(0);
  await expect(page.locator('video')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

const guru: AuthUser = { id: '50000000-0000-4000-8000-000000000001', nip: 'ui-fixture', fullName: 'Guru UI Fixture',
  role: 'USER', isActive: true, mustChangePassword: false };

test('teacher edit renders the private enrollment photo on mobile and laptop',async({page})=>{
  const admin:AuthUser={...guru,role:'SUPER_ADMIN'};
  // One-pixel PNG fixture tests image rendering; it contains no human face.
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5R8AAAAASUVORK5CYII=','base64');
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path===`/api/admin/teachers/${guru.id}/face-photo`){
      await route.fulfill({contentType:'image/png',body:png,headers:{'Cache-Control':'no-store'}});return;
    }
    const body=path==='/api/auth/me'?{user:admin}:path==='/api/admin/teachers'?{
      data:[{...guru,whatsappNumber:null,gender:'MALE',temporaryPasswordExpiresAt:null,
        createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z'}],
      pagination:{page:1,pageSize:20,totalItems:1,totalPages:1},
    }:{error:{code:'FIXTURE_UNHANDLED',message:'Fixture'}};
    await route.fulfill({json:body});
  });
  await page.goto('/admin/teachers');
  await page.getByRole('button',{name:'Ubah',exact:true}).filter({visible:true}).click();
  const photo=page.getByRole('dialog').getByRole('img',{name:'Foto pendaftaran wajah '+guru.fullName});
  await expect(photo).toBeVisible();expect(await photo.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBe(1);
  expect(await photo.getAttribute('src')).toMatch(/^blob:/);
  await page.getByRole('button',{name:'Batal',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('simple enrollment waits for submit with a centered oval and shows saved confirmation',async({page})=>{
  let submitted=false;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body:unknown={error:{code:'FIXTURE_UNHANDLED',message:'Fixture'}};
    if(path==='/api/auth/me')body={user:guru};
    else if(path==='/api/face/enrollment/status')body={status:'NOT_ENROLLED',modelVersion:null,mode:'SIMPLE_LOCAL'};
    else if(path==='/api/face/enrollment/sessions')body={sessionId:guru.id,expiresAt:new Date(Date.now()+120000).toISOString(),modelVersion:'fixture',mode:'SIMPLE_LOCAL'};
    else if(path==='/api/face/enrollment/submit'){
      const input=route.request().postDataJSON() as {frames:unknown[]};
      expect(Object.keys(input).sort()).toEqual(['frames','sessionId']);expect(input.frames).toHaveLength(3);
      submitted=true;body={status:'ACTIVE',modelVersion:'fixture'};
    }
    await route.fulfill({json:body});
  });
  await page.goto('/guru/face-enrollment');
  await expect(page.getByText('Hadapkan wajah ke kamera di tengah oval.',{exact:false})).toBeVisible();
  await page.getByRole('checkbox').check();await page.getByLabel('Konfirmasi password').fill('Face1234');
  await page.getByRole('button',{name:'Mulai pendaftaran'}).click();
  const oval=page.locator('.face-oval');await expect(oval).toBeVisible();
  const bounds=await oval.boundingBox(),camera=await page.locator('.camera-box').boundingBox();
  expect(Math.abs(bounds!.x+bounds!.width/2-camera!.x-camera!.width/2)).toBeLessThan(2);
  expect(Math.abs(bounds!.y+bounds!.height/2-camera!.y-camera!.height/2)).toBeLessThan(2);
  expect(submitted).toBe(false);
  await page.getByRole('button',{name:'Daftarkan wajah',exact:true}).click();
  await expect(page.getByText('Wajah terdaftar. Anda dapat melakukan Absen Masuk dan Absen Pulang.')).toBeVisible();
  await expect(page.locator('.success-mark')).toBeVisible();
  expect(submitted).toBe(true);await expect(page.locator('img.face-frame')).toHaveCount(0);
  expect(await page.locator('video').evaluate(element=>(element as HTMLVideoElement).srcObject)).toBeNull();
});

test('simple attendance opens camera and GPS together and submits one frame',async({page,context})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:-6.2,longitude:106.816666,accuracy:10});
  const schedule={scheduleType:'WEEKDAY',checkInOpen:'05:30',workStart:'07:00',checkInClose:'08:00',checkoutOpen:'12:00',workEnd:'15:35',checkoutClose:'17:00',targetMinutes:515};
  const record={id:guru.id,workDate:'2026-10-12',checkInAt:'2026-10-12T00:05:00.000Z',latitude:-6.2,longitude:106.816666,accuracyMeters:10,distanceMeters:0,
    workStart:'07:00',workEnd:'15:35',checkoutClose:'17:00',targetMinutes:515,arrivalLateMinutes:0,status:'CHECKED_IN'};
  let submitted=false,ordinaryRequests=0;
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let body:unknown={error:{code:'FIXTURE_UNHANDLED',message:'Fixture'}};
    if(path==='/api/auth/me')body={user:guru};
    else if(path==='/api/attendance/today')body={serverNow:'2026-10-12T00:05:00.000Z',workDate:'2026-10-12',state:submitted?'CHECKED_IN':'READY_TO_CHECK_IN',
      schedule,attendance:submitted?record:null,locationRequirement:{maxAccuracyMeters:15},faceVerificationMode:'SIMPLE_LOCAL'};
    else if(path==='/api/request-quotas')body={month:'2026-10',lateArrival:{limit:2,used:0,remaining:2},earlyDeparture:{limit:2,used:0,remaining:2}};
    else if(path==='/api/attendance/face/sessions'){
      expect(route.request().postDataJSON()).toEqual({action:'CHECK_IN'});
      body={sessionId:guru.id,expiresAt:new Date(Date.now()+90000).toISOString(),modelVersion:'fixture',mode:'SIMPLE_LOCAL'};
    }else if(path==='/api/attendance/face/submit'){
      const input=route.request().postDataJSON() as {frame:unknown;location:{accuracyMeters:number}};
      expect(Object.keys(input).sort()).toEqual(['frame','location','sessionId']);expect(input.location.accuracyMeters).toBe(10);
      expect(input.frame).toBeTruthy();submitted=true;body=record;
    }else if(path==='/api/attendance/check-in')ordinaryRequests++;
    await route.fulfill({json:body});
  });
  await page.goto('/guru/absen');await page.getByRole('button',{name:'Absen Masuk sekarang'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('video')).toBeVisible();
  await expect(page.getByText('Absen Masuk berhasil dicatat',{exact:false})).toBeVisible();
  expect(submitted).toBe(true);expect(ordinaryRequests).toBe(0);await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('first enrollment and training show a mirrored preview following the user body direction', async ({ page }) => {
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/me' ? { user: guru }
      : path === '/api/face/enrollment/status' ? { status: 'NOT_ENROLLED', modelVersion: null } : null;
    if (body === null) unexpected.push(path);
    await route.fulfill({ status: body === null ? 404 : 200, json: body ?? { error: { code: 'UI_FIXTURE_UNHANDLED', message: 'Unhandled fixture' } } });
  });
  await page.goto('/guru/face-enrollment');
  await expect(page.getByText('Status: Belum terdaftar', { exact: true })).toBeVisible();
  await expect(page.getByText('Pendaftaran pertama dapat dilakukan langsung di sini tanpa izin daftar ulang dari SuperAdmin.')).toBeVisible();
  await expect(page.locator('video')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  await expect(page.getByText('Pratinjau mengikuti sisi tubuh Anda: kiri Anda tampil di kiri layar.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mulai pendaftaran' })).toBeDisabled();
  await expect(page.getByText('Gambar diambil otomatis saat posisi sudah pas.', { exact: false })).toBeVisible();
  await showCamera(page, 'app-face-enrollment-page', 'CAPTURING');
  await page.goto('/guru/face-challenge');
  await expect(page.getByRole('heading', { name: 'Latihan verifikasi wajah' })).toBeVisible();
  await expect(page.locator('video')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  await expect(page.getByText('Pratinjau mengikuti sisi tubuh Anda: kiri Anda tampil di kiri layar.', { exact: true })).toBeVisible();
  await showCamera(page, 'app-face-challenge-page', 'ACTIVE');
  expect(unexpected).toEqual([]);
});

test('SuperAdmin gets a useful first-enrollment explanation instead of a generic session exception', async ({ page }) => {
  const unexpected: string[] = [];
  const admin: AuthUser = { ...guru, id: '50000000-0000-4000-8000-000000000002', role: 'SUPER_ADMIN', fullName: 'Admin UI Fixture' };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown, status = 200;
    if (path === '/api/auth/me') body = { user: admin };
    else if (path === '/api/admin/teachers') body = { data: [{ ...guru, whatsappNumber: null, gender: 'MALE',
      temporaryPasswordExpiresAt: null, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z' }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } };
    else if (path === `/api/admin/teachers/${guru.id}/face-reenrollment`) {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({ identityReviewed: true });
      status = 409;body = { error: { code: 'REENROLLMENT_NOT_NEEDED', message: 'Enrollment tidak dapat dilanjutkan. Periksa sesi atau hubungi admin.' } };
    } else { unexpected.push(path);status = 404;body = { error: { code: 'UI_FIXTURE_UNHANDLED', message: 'Unhandled fixture' } }; }
    await route.fulfill({ status, json: body });
  });
  await page.goto('/admin/teachers');
  await page.getByRole('button', { name: 'Izinkan daftar wajah ulang' }).filter({ visible: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Guru yang belum terdaftar dapat mendaftar langsung dari Profil Saya');
  await page.getByRole('button', { name: 'Identitas sudah diperiksa' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Guru belum memiliki template wajah. Pendaftaran pertama dapat dilakukan langsung dari Profil Saya tanpa izin daftar ulang.');
  await expect(alert).not.toContainText('Periksa sesi atau hubungi admin');
  expect(unexpected).toEqual([]);
});
