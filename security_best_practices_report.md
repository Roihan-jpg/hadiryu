# Laporan Audit Keamanan HadirYu

Tanggal audit: 23 September 2026  
Target kode: commit `c786aa3` pada branch `dashboard-ui`  
Target hosted: `https://hadir-yu.roihanboizz2006.workers.dev`  
Versi Worker hasil deploy: `9d865072-c7d8-4848-b1db-db2183ceccf0`

## Ringkasan Eksekutif

Tidak ditemukan kerentanan Critical atau High yang dapat dibuktikan dalam cakupan audit ini. Kontrol dasar aplikasi sudah kuat: sesi opaque disimpan sebagai hash, password memakai scrypt dan perbandingan konstan, cookie aman, route memakai guard role/kepemilikan, input utama divalidasi Zod, upload dibatasi dan diperiksa magic byte, service key hanya digunakan backend, seluruh tabel aplikasi exposed memiliki RLS, fungsi database memakai `security invoker` dan `search_path` terkunci, bucket privat, serta log dan audit memiliki redaksi secret.

Tiga risiko Medium perlu diprioritaskan:

1. SPA yang disajikan langsung oleh Cloudflare Assets tidak memperoleh CSP dan header browser lain.
2. lockout login memakai read-modify-write non-atomik dan rate limiter in-memory tidak memberi jaminan global pada deployment multi-isolate.
3. password diwajibkan tepat delapan karakter, termasuk untuk SuperAdmin.

Deployment terbaru dan smoke test berhasil. Audit aktif hosted dibatasi pada operasi read-only dan lifecycle sesi; pengujian IDOR lintas-role dilakukan melalui test lokal karena hanya tersedia akun SuperAdmin. Kredensial, token sesi, dan koordinat tidak dicatat dalam laporan ini.

Password SuperAdmin yang dibagikan sebelum audit telah dirotasi melalui endpoint resmi setelah pengujian selesai. Rotasi mengembalikan 200, sesi lama menjadi 401, login dengan credential baru berhasil, dan sesi verifikasi kemudian di-logout.

## Checklist Audit

| Area | Status | Bukti ringkas |
|---|---|---|
| Lint | Lulus | `npm run lint` |
| Typecheck | Lulus dengan 1 warning non-security | `npm run typecheck`; `RouterLink` tidak digunakan |
| Test API | Lulus | 64 file, 314 test |
| Test web | Lulus | 35 file, 177 test |
| Test SQL/RLS | Lulus | 4 file, 95 test |
| Supabase advisor lokal | Lulus | Tidak ada issue |
| Build produksi | Lulus dengan warning | Bundle berhasil; ada direct `eval` dari `lottie-web` |
| Git diff check | Lulus | Tidak ada whitespace error sebelum laporan dibuat |
| Secret di Git | Lulus | `.env`, key, dan credential runtime tidak tracked |
| Worker secret binding | Lulus | Hanya nama `SUPABASE_URL` dan `SUPABASE_SECRET_KEY` terdeteksi; nilai tidak dibaca |
| Deploy Worker | Lulus | Versi `9d865072-c7d8-4848-b1db-db2183ceccf0` aktif |
| Smoke SPA/API | Lulus | `/` 200, API unauthorized 401, Origin asing 403 |
| Login/session/logout hosted | Lulus | Cookie aman, endpoint admin read-only 200, token lama 401 setelah logout |
| Rotasi credential SuperAdmin | Lulus | Password berubah; sesi lama dicabut; login baru dan logout berhasil |
| File privat | Lulus | Foto hanya dengan sesi dan `Cache-Control: private, no-store`; attachment memvalidasi UUID |
| RLS/grant/function database | Lulus | RLS seluruh tabel aplikasi; fungsi `security invoker`; advisor lokal bersih |
| Advisor database hosted | Perlu verifikasi | Tidak dijalankan karena credential CLI hosted tidak tersedia dalam environment audit |
| IDOR lintas-role hosted | Tidak diuji | Hanya akun SuperAdmin tersedia; regression test lokal digunakan |
| Rate-limit agresif hosted | Tidak diuji | Dihindari agar tidak mengunci akun atau mengganggu pengguna |

## Critical

Tidak ada temuan Critical.

## High

Tidak ada temuan High yang terbukti.

## Medium

### SEC-001 — Header keamanan tidak diterapkan pada SPA Cloudflare Assets

- **Rule ID:** EXPRESS-HEADERS-001, JS-CSP-001, JS-CSP-002
- **Lokasi:** `worker/index.ts:107-120`, `wrangler.jsonc:14-18`, `apps/api/src/security.ts:45-62`
- **Bukti:** hanya request `/api`, `/api/*`, dan secara logika `/health` yang diarahkan ke Express. Request SPA dikembalikan langsung melalui `workerEnv.ASSETS.fetch(request)`, sehingga middleware Helmet tidak berjalan. Pemeriksaan hosted terhadap `/` mengembalikan HTML tanpa `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, atau `Referrer-Policy`; endpoint API memiliki seluruh header tersebut.
- **Dampak:** bila ada XSS atau injeksi markup di masa depan, browser tidak memiliki pembatas script tambahan. SPA juga tidak memiliki perlindungan clickjacking eksplisit dan kebijakan referrer dari aplikasi.
- **Perbaikan:** setelah `ASSETS.fetch`, buat `Response` baru dan tambahkan header khusus aset. Gunakan CSP yang kompatibel dengan Angular, Leaflet, font lokal, data/blob image yang benar-benar diperlukan, serta tile `https://tile.openstreetmap.org`. Terapkan `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `X-Content-Type-Options: nosniff`, dan `Referrer-Policy: no-referrer`.
- **Mitigasi:** pastikan Angular tetap memakai binding aman dan tidak memperkenalkan sink HTML mentah; pertahankan URL eksternal yang ketat.
- **Catatan false positive:** Cloudflare dapat menambahkan sebagian header transport di edge, tetapi respons aktual membuktikan header aplikasi di atas tidak ada.
- **Catatan kompatibilitas:** bundle `lottie-web` saat ini mengandung direct `eval`. CSP tanpa `'unsafe-eval'` dapat mematahkan animasi pembuka. Ganti dengan build Lottie yang tidak membawa expression evaluator atau hapus fitur tersebut sebelum mengaktifkan CSP ketat; jangan menyelesaikannya dengan menambahkan `'unsafe-eval'`.

### SEC-002 — Lockout login tidak atomik dan rate limiting tidak terdistribusi

- **Rule ID:** EXPRESS-RATE-001, EXPRESS-AUTH-001
- **Lokasi:** `apps/api/src/supabase-auth.ts:237-248`, `apps/api/src/supabase-auth.ts:250-302`, `apps/api/src/security.ts:22-27`, `apps/api/src/security.ts:128-135`, `worker/index.ts:80-103`
- **Bukti:** login membaca `failed_login_attempts`, menghitung nilai berikutnya di aplikasi, lalu menjalankan update biasa. Beberapa request paralel dapat membaca nilai yang sama dan saling menimpa. `express-rate-limit` tidak diberi shared store sehingga memakai memory store per proses/isolate. Worker dapat melayani request pada lebih dari satu isolate.
- **Dampak:** penyerang dapat memperoleh lebih banyak percobaan password daripada batas lima yang dimaksud. Sebaliknya, bila bridge Node memberi IP yang sama untuk banyak pengguna, limiter in-memory juga dapat menimbulkan penolakan layanan bersama pada satu isolate.
- **Perbaikan:** pindahkan increment, keputusan lockout, dan reset counter ke RPC PostgreSQL atomik dengan row lock atau single conditional update. Gunakan rate limiting di Cloudflare edge atau store terdistribusi yang sesuai; key harus membedakan IP dan identitas login yang telah dinormalisasi tanpa mencatat password.
- **Mitigasi:** pertahankan scrypt, dummy hash untuk akun tak dikenal, respons credential generik, dan monitoring lonjakan `INVALID_CREDENTIALS`/`ACCOUNT_LOCKED`.
- **Catatan false positive:** test tunggal tidak mereproduksi race secara deterministik; risikonya berasal dari pola concurrency yang terlihat langsung pada kode. Lockout database tetap memberi perlindungan parsial.

### SEC-003 — Kebijakan password membatasi semua akun menjadi tepat delapan karakter

- **Rule ID:** AUTH-PASSWORD-001
- **Lokasi:** `packages/contracts/src/auth.ts:24-30`, `apps/api/src/supabase-auth.ts:79-106`
- **Bukti:** schema menolak password yang panjangnya bukan delapan karakter dan membatasi alfabet ke ASCII alfanumerik. Hashing scrypt menggunakan `N=16384`, `r=8`, `p=1` dengan salt acak 16 byte.
- **Dampak:** ruang pencarian password dibatasi dan passphrase yang lebih panjang tidak dapat digunakan. Risiko terutama tinggi untuk SuperAdmin bila password digunakan ulang, dibagikan, atau pernah tampil di kanal komunikasi.
- **Perbaikan:** keputusan ini mengubah aturan produk dan wajib disetujui terlebih dahulu. Rekomendasi berikutnya adalah minimum 12 karakter, maksimum aman (misalnya 64/128), menerima passphrase, menolak password umum/terbocor bila fasilitas tersedia, dan memaksa rotasi credential SuperAdmin yang telah dibagikan.
- **Mitigasi:** pertahankan lockout, scrypt, session revocation saat password berubah, password reset acak, dan jangan gunakan password yang sama di sistem lain.
- **Catatan false positive:** aturan tepat delapan karakter adalah keputusan PRD, bukan implementasi yang menyimpang. Karena itu audit hanya merekomendasikan perubahan melalui keputusan produk tertulis.

## Low

### SEC-004 — `/health` hosted tidak menguji API Worker

- **Rule ID:** OPS-HEALTH-001
- **Lokasi:** `apps/api/src/app.ts:304-308`, `worker/routing.ts:1-3`, `wrangler.jsonc:14-18`
- **Bukti:** router Worker mengenali `/health`, tetapi `assets.run_worker_first` hanya mencantumkan `/api` dan `/api/*`. Respons hosted `/health` adalah `text/html` SPA, bukan JSON `{ "status": "ok" }`.
- **Dampak:** uptime monitor dapat melaporkan sehat ketika API bridge atau dependency backend gagal.
- **Perbaikan:** tambahkan `/health` ke `run_worker_first`; bila endpoint dipakai untuk readiness, lakukan pemeriksaan dependency yang bounded dan tidak membocorkan detail internal.
- **Mitigasi:** monitor endpoint API read-only yang benar-benar melewati Worker sampai konfigurasi diperbaiki.
- **Catatan false positive:** routing function sudah benar; masalah berada pada routing aset sebelum handler dipanggil.

### SEC-005 — Tipe binding Worker tidak sinkron dengan konfigurasi

- **Rule ID:** WORKERS-TYPES-001
- **Lokasi:** `worker/index.ts:33-43`, `worker-configuration.d.ts`, `wrangler.jsonc:14-18`
- **Bukti:** `npx wrangler types --check` gagal karena generated types kedaluwarsa. Kode mendefinisikan `WorkerBindings` manual dan memaksa `env as unknown as WorkerBindings`.
- **Dampak:** perubahan nama/jenis binding dapat lolos typecheck dan baru gagal saat runtime/deploy.
- **Perbaikan:** jalankan `npx wrangler types`, gunakan interface generated sebagai parameter `ExportedHandler`, dan hilangkan double cast. Tambahkan `wrangler types --check` ke CI.
- **Mitigasi:** dry-run dan smoke test saat ini membuktikan binding produksi yang ada bekerja.
- **Catatan false positive:** ini bukan kebocoran langsung; risikonya adalah drift konfigurasi dan kegagalan keamanan/availability pada perubahan berikutnya.

### SEC-006 — Advisory transitif `uuid` melalui ExcelJS

- **Rule ID:** EXPRESS-DEPS-001
- **Lokasi:** `apps/api/package.json` dependency `exceljs@4.4.0`; `node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:1,43,77`
- **Bukti:** `npm audit --omit=dev` melaporkan advisory Moderate pada `uuid<11.1.1` terkait bounds check v3/v5/v6 saat caller memberikan buffer. ExcelJS membawa `uuid@8.3.2`, tetapi call path yang ditemukan hanya memakai `uuid.v4()` tanpa buffer.
- **Dampak:** advisory tidak tampak reachable dari alur ekspor saat ini, tetapi dependency lama tetap menambah risiko supply-chain dan dapat menjadi relevan bila ExcelJS mengubah call path.
- **Perbaikan:** pantau rilis ExcelJS yang memperbarui `uuid`; evaluasi override hanya setelah regression test file Excel lengkap. Jangan downgrade otomatis ke ExcelJS 3.4.0 seperti saran mekanis npm karena dapat menyebabkan regresi API.
- **Mitigasi:** template input bersifat read-only milik aplikasi dan bukan upload pengguna; output divalidasi serta diuji.
- **Catatan false positive:** severity npm adalah Moderate, tetapi exploitability aplikasi dinilai Low karena fungsi terdampak tidak dipanggil.

## Observasi Positif

- `apps/api/src/auth.ts:68-85` mengatur cookie `HttpOnly`, `SameSite=Strict`, `Secure` di produksi, root path, dan expiry bounded.
- `apps/api/src/supabase-auth.ts:218-234` membuat token acak 256-bit dan hanya menyimpan SHA-256 token di database.
- `apps/api/src/supabase-auth.ts:305-327` memeriksa expiry, revocation, serta status akun pada setiap request.
- `apps/api/src/request-attachments.ts:38-73` membatasi file 5 MB, satu file, MIME allowlist, magic byte, dan nama file; download memeriksa owner/SuperAdmin serta memakai `private, no-store`.
- `apps/api/src/profile.ts:50-71` melakukan kontrol serupa untuk foto 2 MB, dan respons hosted terbukti privat serta `nosniff`.
- `apps/api/src/observability.ts:5-18,35-64` meredaksi credential dan koordinat; error produksi tidak membocorkan stack.
- `supabase/migrations/20260904174843_app_accounts_profile_photos.sql:70-76` mengaktifkan RLS dan mencabut akses `anon`/`authenticated` pada account/session.
- Seluruh fungsi database yang ditemukan memakai `security invoker` dan `search_path = ''`; tidak ditemukan `security definer`.
- Bucket foto dan attachment bersifat privat dengan batas ukuran/MIME, dan Storage hanya diakses backend service-role.
- Test SQL membuktikan RLS, immutability timestamp absensi, kuota, dan audit secret guard; advisor lokal bersih.
- Origin asing ditolak di edge, mutasi tanpa header CSRF ditolak, dan logout hosted membuat token sebelumnya tidak berlaku.

## Keterbatasan Audit

- Tidak dilakukan exploit testing destruktif, fuzzing volume tinggi, denial-of-service, atau brute force hosted.
- Tidak dilakukan mutation pada absensi, izin, akun, jadwal, geofence, laporan, atau data bisnis hosted.
- Advisor Supabase hosted tidak dijalankan karena environment tidak memiliki credential CLI database hosted; migration yang sama lulus test/advisor lokal.
- Hanya akun SuperAdmin tersedia untuk hosted. Penolakan lintas-role dan IDOR dibuktikan melalui unit/integration test lokal, bukan akun Guru/Satpam hosted.
- Infrastruktur Cloudflare/Supabase di luar konfigurasi repository tidak diaudit secara menyeluruh.

## Urutan Perbaikan yang Disarankan

1. Perbaiki lockout atomik dan rate limiting terdistribusi.
2. Hilangkan direct `eval` dari jalur Lottie, lalu pasang CSP/header pada respons SPA.
3. Arahkan `/health` melalui Worker API.
4. Regenerasi binding types dan jadikan `wrangler types --check` gate CI.
5. Ajukan keputusan produk untuk memperpanjang kebijakan password.
6. Pantau pembaruan ExcelJS/uuid dan jalankan kembali audit dependency.
