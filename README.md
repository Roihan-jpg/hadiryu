# HadirYu

HadirYu adalah aplikasi absensi dan administrasi kehadiran sekolah. Guru memakai antarmuka mobile-first untuk check-in, checkout, izin, dan riwayat. SuperAdmin mengelola akun, jadwal, geofence, approval, laporan, dan ekspor Excel.

## Mulai cepat

Prasyarat utama: Node.js `22.22.3+`, `24.15.0+`, atau `26+`; npm `11+`; serta project Supabase kosong.

```bash
npm ci
npm run setup
npm run dev
```

Installer memvalidasi credential, menjalankan seluruh migration berurutan, menulis `.env`, membuat akun SuperAdmin dan Guru demo, lalu memeriksa schema, RLS, dan akun. Database connection string hanya dipakai selama proses dan tidak disimpan.

> HadirYu memakai autentikasi aplikasi berbasis NIP pada `app_accounts` dan session cookie opaque. Supabase Auth tersedia sebagai bagian platform Supabase, tetapi bukan sumber akun login aplikasi ini.

Setelah login pertama, buka **Jadwal & Lokasi** dan isi konfigurasi sekolah sebelum absensi operasional digunakan. Installer tidak menanam koordinat sekolah palsu.

## Stack

- Angular standalone, Angular Material, signals
- Express 5 dan TypeScript strict
- PostgreSQL/Supabase dengan RLS
- Cloudflare Workers untuk deployment full-stack opsional
- Vitest, Node Test Runner, dan Playwright

Nama package internal `@absensi/*` dipertahankan untuk kompatibilitas build. Nama produk dan distribusi adalah **HadirYu**.

## Dokumentasi

- [INSTALLATION.md](INSTALLATION.md) — instalasi pembeli dari nol
- [SETUP.md](SETUP.md) — perilaku dan recovery installer
- [DEPLOYMENT.md](DEPLOYMENT.md) — deployment hosted
- [DATABASE.md](DATABASE.md) — migration, seed, dan update schema
- [SECURITY.md](SECURITY.md) — model keamanan dan pengelolaan secret
- [DEVELOPMENT.md](DEVELOPMENT.md) — workflow contributor
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — solusi error umum
- [LICENSE.md](LICENSE.md) — template lisensi distribusi yang wajib dilengkapi pemilik

## Perintah penting

```bash
npm run setup
npm run setup:validate
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run setup` aman dijalankan ulang. Migration yang sudah tercatat diverifikasi checksum-nya dan akun existing tidak di-reset pada instalasi yang sudah selesai.

