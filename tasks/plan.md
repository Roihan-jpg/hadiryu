# Implementation Plan: T15 E2E dan Release Readiness

## Overview

Menambahkan harness Playwright yang menjalankan smoke test MVP melalui API dan UI nyata, command hosted Supabase yang terkunci ke project `agtmvpjtqcmsqvatskjg`, bootstrap SuperAdmin berbasis environment secret, serta dokumentasi deployment tanpa menyimpan credential atau mereset/seed database hosted.

## Architecture Decisions

- Playwright dijalankan dari root workspace dan hanya memakai Chromium agar smoke suite tetap kecil; API dan Angular lokal dinyalakan melalui `webServer` Playwright.
- Runner lokal mengambil URL dan key ephemeral dari `supabase status`, lalu meneruskannya hanya melalui environment child process.
- Runner hosted mewajibkan seluruh URL, key, dan credential smoke melalui environment; ia tidak membuat project, tidak seed/reset database, dan tidak mengubah konfigurasi hosted secara otomatis.
- Script hosted memvalidasi project ref tetap sebelum menjalankan CLI. Deploy selalu melakukan `db push --dry-run` sebelum `db push --linked` dan tidak pernah memakai `--include-seed`.
- Local smoke menyiapkan data disposable setelah `db:reset`; hosted smoke memakai akun Guru khusus yang sudah disiapkan agar test berulang tidak menimpa akun/data production yang ada.

## Task List

### Phase 1: Toolchain dan Guardrail

- [x] Tambahkan dependency/config Playwright, ignore artefak, contoh environment production, dan wrapper command hosted yang fail-closed.
- [x] Tambahkan test untuk validasi konfigurasi/guardrail runner sebelum implementasinya.

### Checkpoint: Toolchain

- [x] Unit test guardrail lulus dan seluruh command hanya menerima secret dari environment.

### Phase 2: Local E2E

- [x] Tambahkan setup lokal yang membaca key Supabase lokal dan bootstrap SuperAdmin tanpa menulis secret ke disk.
- [x] Tambahkan smoke flow setup Guru, login/ganti password, check-in/checkout, izin, approval, preview, dan ekspor.

### Checkpoint: Local Smoke

- [x] `npm run db:reset && npm run test:e2e` lulus tanpa skip atau retry berlebihan.

### Phase 3: Hosted Readiness

- [x] Tambahkan mode hosted yang memvalidasi project URL/ref dan memakai credential smoke khusus dari environment.
- [x] Dokumentasikan link, dry-run/deploy migration, advisors, bootstrap, dan smoke test hosted.

### Phase 4: Release Gate

- [x] Jalankan seluruh command verifikasi lokal.
- [ ] Jalankan command hosted yang dapat dijalankan dengan akses tersedia; catat blocker credential/akses secara eksplisit tanpa menandai hasil palsu.
- [ ] Review correctness, simplicity, architecture, security, dan performance; lalu perbarui `TASKS.md`/`MEMORY.md` hanya bila semua acceptance gate benar-benar lulus.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Command salah menargetkan project lain | Tinggi | Project ref dan URL target berupa konstanta yang divalidasi sebelum setiap command hosted. |
| Seed/reset development mengenai hosted | Tinggi | Tidak ada wrapper hosted untuk reset; deploy menolak argumen tambahan dan hanya memanggil `db push` tanpa seed. |
| Secret bocor ke repository/log | Tinggi | Input hanya melalui environment, placeholder saja yang dikomit, dan output runner tidak mencetak nilai secret. |
| Absensi E2E bergantung jam nyata | Sedang | Local setup membuat window satu menit berikutnya dengan waktu server; hosted smoke memvalidasi konfigurasi/window yang memang disiapkan untuk akun smoke. |
| Smoke hosted meninggalkan data uji | Sedang | Gunakan akun Guru khusus dan tanggal izin yang dikonfigurasi operator; dokumentasikan bahwa project harus non-production/staging atau data smoke telah disetujui. |

## Open Questions

- Akses CLI aktif saat ini tidak menampilkan project target, dan environment belum menyediakan database password/key/credential smoke. Implementasi dapat diselesaikan serta diverifikasi lokal; gate hosted tetap terbuka sampai credential environment yang sesuai tersedia.
