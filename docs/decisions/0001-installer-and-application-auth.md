# ADR 0001: Installer langsung PostgreSQL dan autentikasi aplikasi

- Status: accepted
- Tanggal: 2026-09-21

## Konteks

Source akan didistribusikan sebagai HadirYu dan pembeli harus dapat memasang schema tanpa mengetahui urutan SQL. Repository terkini sudah memakai login NIP dengan `profiles`, `app_accounts`, dan `app_sessions`; Supabase Auth tidak lagi menjadi sumber akun aplikasi.

## Keputusan

`npm run setup` memakai connection string PostgreSQL sementara untuk menjalankan migration timestamp di dalam transaction dan menyimpan checksum pada schema private `hadiryu_internal`. Credential runtime yang disimpan hanya Project URL, publishable key, dan secret key. Akun awal dibuat pada tabel autentikasi aplikasi, bukan `auth.users`.

## Konsekuensi

- Installer dapat dijalankan ulang dan mendeteksi drift migration.
- Connection string tidak perlu dipertahankan setelah setup.
- Upgrade pembeli harus memakai migration baru dan installer yang sama.
- Supabase CLI tetap dipakai untuk workflow developer lokal.
- Dokumentasi atau konsep lama yang meminta pembuatan akun Supabase Auth tidak berlaku untuk arsitektur runtime saat ini.
