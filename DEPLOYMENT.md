# Deployment HadirYu

Dokumen ini memakai Cloudflare Worker full-stack yang menyajikan asset Angular dan API Express dari origin yang sama. Tidak ada project ID, URL penjual, atau secret yang dipatok di source.

## 1. Selesaikan setup database

Jalankan instalasi dan verifikasi terlebih dahulu:

```bash
npm ci
npm run setup
npm run setup:validate
```

Jangan deploy sebelum login SuperAdmin dan konfigurasi **Jadwal & Lokasi** selesai.

## 2. Siapkan Cloudflare Worker

Login ke akun Cloudflare milik pembeli:

```bash
npx wrangler login
```

Nama Worker default pada `wrangler.jsonc` adalah `hadir-yu`. Ubah nama ini bila sudah dipakai di akun pembeli. `compatibility_date` dan `nodejs_compat` harus dipertahankan serta diperbarui secara teruji pada release berikutnya.

## 3. Simpan runtime secret

URL Supabase dan secret key digunakan oleh backend Worker. Keduanya sengaja tidak ada di `wrangler.jsonc`:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
```

Masukkan nilai project pembeli saat diminta. Jangan memakai secret penjual, project demo, atau key dari sekolah lain. Publishable key tidak dibutuhkan oleh bundle frontend karena Angular tidak mengakses Supabase Data API secara langsung.

## 4. Verifikasi dan deploy

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx wrangler deploy
```

Worker melayani asset hasil build dari `apps/web/dist/web/browser` dan menjalankan Worker terlebih dahulu hanya untuk `/api` serta `/api/*`. Pemeriksaan origin API memakai origin URL request yang sedang dilayani, sehingga custom domain dan domain `workers.dev` tidak perlu dipatok ke source.

## 5. Custom domain

Tambahkan custom domain melalui dashboard Cloudflare atau konfigurasi route milik akun pembeli. Setelah DNS aktif, uji:

- login dan logout;
- cookie session beratribut `Secure`, `HttpOnly`, dan kebijakan SameSite yang benar;
- request dengan `Origin` asing ditolak;
- check-in meminta lokasi hanya setelah tombol ditekan;
- upload lampiran dan foto profil;
- ekspor Excel dari salinan template;
- route Angular tetap kembali ke SPA pada refresh.

## Alternatif: Express terpisah

API juga dapat dijalankan sebagai process Node.js:

```bash
npm run build
npm run start --workspace @absensi/api
```

Sediakan variable runtime dari `.env.production.example` melalui secret manager platform. Untuk deployment lintas-origin, isi `CORS_ALLOWED_ORIGINS` dengan origin browser exact, aktifkan `SESSION_COOKIE_SECURE=true`, dan set `TRUST_PROXY_HOPS` sesuai jumlah reverse proxy yang benar-benar dipercaya.

## Migration release berikutnya

Untuk pembeli yang memakai paket source baru, jalankan `npm ci` lalu `npm run setup` kembali. Installer memverifikasi checksum migration lama dan hanya menerapkan file baru. Backup database sebelum upgrade production dan jangan memakai `supabase db reset` pada hosted project.

Script `db:link:hosted`, `db:deploy:hosted`, dan `db:advisors:hosted` menurunkan project ref dari `SUPABASE_URL`; script akan menolak linked project yang berbeda. `db:deploy:hosted` selalu menjalankan dry-run sebelum apply dan tidak menjalankan seed.

## Rollback

Migration database bersifat forward-only. Rollback release aplikasi dilakukan dengan redeploy source versi sebelumnya hanya jika schema tetap kompatibel. Untuk perubahan schema yang memerlukan koreksi, buat migration baru; jangan mengedit migration lama atau melakukan reset production.
