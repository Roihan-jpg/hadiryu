# T02 Checklist

- [x] Supabase CLI/config lokal dan root scripts tersedia.
- [x] Integration test database ditulis sebelum migration dan berjalan pada PostgreSQL Supabase lokal.
- [x] Seluruh enum, tabel, constraint, dan index TechDesign tersedia dan terverifikasi.
- [x] RLS aktif pada seluruh tabel public dan akses lintas-user ditolak.
- [x] Attendance timestamp tidak dapat diubah dan admin note append-only.
- [x] Audit foundation tersedia tanpa secret atau data production.
- [x] Seed development deterministik dan non-rahasia.
- [x] `npm run db:reset && npm run db:advisors && npm run test:api -- database` berhasil.
- [x] T02 dicentang dan `MEMORY.md` diganti dengan snapshot terbaru.
