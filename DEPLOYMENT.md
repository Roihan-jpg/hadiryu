# Environment dan Deployment

Dokumen ini menjelaskan release gate untuk project Supabase hosted yang sudah ditetapkan:

- Project ref: `agtmvpjtqcmsqvatskjg`
- URL: `https://agtmvpjtqcmsqvatskjg.supabase.co`

Repository tidak membuat project Supabase baru dan belum mendeploy Web/API ke provider aplikasi. Smoke hosted menjalankan Web dan API di komputer lokal, tetapi memakai Auth/PostgreSQL project hosted di atas.

## Prasyarat

- Node.js sesuai `engines` pada `package.json`.
- Docker Desktop untuk stack Supabase lokal.
- Supabase CLI versi `2.115.0` yang sudah dipin di lockfile.
- Chromium Playwright: `npm run e2e:install`.
- Hak akses ke project target, personal access token, dan password database.

Sebelum command CLI dikunci, referensi resmi dan help versi terpasang telah diperiksa:

- [Supabase changelog](https://supabase.com/changelog)
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-link)
- [Local development workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Playwright web server](https://playwright.dev/docs/test-webserver)

Per 27 Agustus 2026, perubahan relevan adalah default PostgreSQL 17 dan tabel baru yang tidak lagi otomatis diekspos ke Data API. Migration repository karena itu tetap mengaktifkan RLS serta memberi `GRANT` secara eksplisit. Workflow declarative `pg-delta` masih alpha dan tidak dipakai untuk release ini.

## Environment

Gunakan `.env.production.example` sebagai daftar nama variable, lalu simpan nilai sebenarnya di secret manager atau environment shell. Jangan menyalin file berisi nilai nyata ke Git.

Runtime API memerlukan:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, dan `SUPABASE_SECRET_KEY`;
- `SESSION_COOKIE_SECURE=true` ketika aplikasi sudah berada di HTTPS;
- `CORS_ALLOWED_ORIGINS` berisi origin Web yang persis;
- `TRUST_PROXY_HOPS` sesuai jumlah reverse proxy sebenarnya.

Command hosted memerlukan `SUPABASE_ACCESS_TOKEN` dan `SUPABASE_DB_PASSWORD`. Script tidak menerima secret sebagai argumen CLI agar nilainya tidak muncul pada command history/process list.

Bootstrap SuperAdmin memerlukan `SUPER_ADMIN_NIP`, `SUPER_ADMIN_FULL_NAME`, dan `SUPER_ADMIN_INITIAL_PASSWORD`. Jalankan setelah migration berhasil:

```bash
npm run bootstrap:super-admin
```

Command bersifat idempotent untuk NIP SuperAdmin yang sudah ada dan tidak mereset password akun tersebut. Password awal wajib diganti melalui halaman login pertama.

## Verifikasi Lokal

Install browser satu kali, lalu jalankan gate lokal dari database bersih:

```bash
npm run e2e:install
npm run db:reset
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`test:e2e` membaca key lokal langsung dari `supabase status -o env`, meneruskannya hanya ke child process, lalu menjalankan flow berikut:

1. bootstrap dan login SuperAdmin;
2. siapkan window jadwal/geofence disposable dan akun Guru setelah local reset;
3. Guru login, mengganti password awal, check-in, checkout, dan mengajukan izin;
4. SuperAdmin menyetujui izin;
5. API preview laporan diverifikasi dan file XLSX diekspor.

## Link dan Migration Hosted

Pastikan environment CLI sudah diisi, lalu jalankan:

```bash
npm run db:link:hosted
npm run db:deploy:hosted
npm run db:advisors:hosted
```

Guardrail setiap script:

- target selalu divalidasi sebagai `agtmvpjtqcmsqvatskjg`;
- deploy menjalankan `db push --linked --dry-run` sebelum apply;
- deploy tidak memakai `--include-seed`;
- advisors memeriksa security dan performance serta gagal pada warning;
- tidak tersedia command wrapper untuk `db reset --linked`.

Jangan pernah menjalankan `supabase db reset --linked`, `db push --include-seed`, atau seed development pada hosted project. Bila migration history remote tidak cocok, hentikan release dan tinjau `supabase migration list`; jangan memakai repair sebelum penyebab drift dipahami.

## Smoke Test Hosted

Siapkan satu akun Guru khusus smoke melalui GUI SuperAdmin. Akun harus aktif, password awal sudah diganti, dan tidak boleh merupakan akun manusia/production. Isi variable berikut:

- `E2E_ADMIN_PASSWORD`: password SuperAdmin setelah pergantian password awal;
- `E2E_TEACHER_NIP` dan `E2E_TEACHER_PASSWORD`: akun Guru smoke khusus;
- `E2E_LATITUDE` dan `E2E_LONGITUDE`: titik valid di dalam geofence sekolah;
- `E2E_LEAVE_DATE`: tanggal hari ini/masa depan yang disetujui untuk data smoke.

Jalankan smoke saat window check-in hosted aktif, atau setelah akun smoke memiliki absensi hari itu. Test melakukan checkout bila window checkout sudah aktif; bila belum, status check-in yang tersimpan tetap diverifikasi. Test tidak membuat Guru, tidak mengubah konfigurasi, tidak mereset password, serta tidak menghapus data. Test dapat membuat absensi dan izin untuk akun smoke, menyetujui izin tersebut, lalu melakukan preview/export:

```bash
npm run test:e2e:hosted
```

Jika tanggal izin sudah memiliki izin Pending atau Approved untuk akun smoke, test memakai record itu sehingga rerun tidak membuat duplikat. Preview/export sengaja gagal bila masih ada izin Pending lain pada bulan tersebut; itu adalah release blocker yang harus diselesaikan, bukan di-skip.

## Batas Deployment Aplikasi

Provider Web/API belum dipilih. Repository hanya menyiapkan build dan environment contract; tidak ada deployment aplikasi yang dijalankan sampai provider, domain HTTPS, reverse proxy, dan secret manager diputuskan secara tertulis.
