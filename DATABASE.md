# Database HadirYu

## Sumber kebenaran schema

Semua perubahan schema berada di `supabase/migrations` dengan nama timestamp. Jangan mengedit migration yang sudah pernah diterapkan; buat migration baru. JSON/TypeScript memakai camelCase, sedangkan PostgreSQL memakai snake_case.

Migration installer dicatat di `hadiryu_internal.schema_migrations`. Workflow developer Supabase CLI tetap dapat dipakai untuk database lokal, tetapi release pembeli sebaiknya dijalankan melalui `npm run setup` agar checksum dan guardrail installer tetap konsisten.

## Seed

`supabase/seed.sql` hanya untuk reset development lokal. Isinya memakai koordinat contoh generik dan tidak membuat akun, password, token, atau data pribadi. Installer hosted tidak menjalankan file seed ini.

Akun minimum dibuat secara eksplisit oleh installer. Jadwal dan geofence production harus disimpan dari UI SuperAdmin sehingga tanggal efektif memakai tanggal server `Asia/Jakarta` dan audit trail tercatat.

## Aturan perubahan

- Timestamp database tetap UTC; `workDate` dihitung di `Asia/Jakarta`.
- Semua tabel aplikasi dalam schema exposed wajib memakai RLS.
- Angular tidak menulis langsung ke Data API.
- Secret/service key hanya digunakan backend.
- Histori konfigurasi sebelum hari server saat ini tidak boleh diubah.
- `report-template.xlsx` read-only; ekspor selalu bekerja pada salinan.

## Development lokal

```bash
npm run db:start
npm run db:reset
npm run db:advisors
```

`db:reset` bersifat destruktif hanya untuk database Supabase lokal. Jangan jalankan reset ke project hosted.

