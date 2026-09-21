# Development HadirYu

## Menyiapkan workspace

```bash
npm ci
npm run db:start
npm run db:reset
npm run test:setup:local
npm run dev
```

Supabase lokal membutuhkan Docker Desktop. `npm run db:reset` menjalankan migration lalu seed development. API berjalan di `127.0.0.1:3000`; Angular di `127.0.0.1:4200` dengan proxy `/api`.

`test:setup:local` harus dijalankan segera setelah reset. Ia menguji adoption migration, pembuatan akun, validasi, dan rerun idempoten tanpa menampilkan password, lalu membersihkan akun integration.

## Struktur

- `apps/api` — Express, repository Supabase, aturan domain
- `apps/web` — Angular standalone
- `packages/contracts` — kontrak Zod bersama
- `supabase/migrations` — schema dan function PostgreSQL
- `scripts/setup` — installer distribusi
- `worker` — adapter Cloudflare Workers

Package scope `@absensi/*` adalah identifier internal legacy. Jangan menggantinya secara parsial; rename package merupakan migration terpisah.

## Verifikasi sebelum merge/release

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Test yang membutuhkan database akan skip atau gagal jelas bila Supabase lokal/Docker tidak aktif. Jangan menghapus atau melemahkan test untuk melewati kegagalan environment.

## Perubahan schema

Buat migration timestamp baru, tambahkan test PostgreSQL/API yang relevan, jalankan reset lokal, lalu jalankan advisor. Jangan mengubah file migration yang sudah diterapkan karena installer memverifikasi checksum.
