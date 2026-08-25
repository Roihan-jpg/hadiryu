# Implementation Plan: T02 Database dan Keamanan Dasar

## Overview

Menambahkan stack Supabase lokal yang dapat dibangun ulang secara deterministik, schema domain lengkap sesuai `TechDesign.md`, policy RLS minimum, audit foundation, seed development non-rahasia, dan integration test database tanpa membuat endpoint auth atau UI.

## Architecture Decisions

- Supabase CLI dipasang sebagai root dev dependency dan seluruh script database selalu menargetkan local stack secara eksplisit.
- Schema domain berada pada satu baseline migration yang dibuat melalui Supabase CLI; seed hanya berisi data development deterministik.
- RLS memberi USER akses baca ke row miliknya dan menolak akses lintas-user; mutation data domain tetap tidak diberikan kepada client. SUPER_ADMIN memperoleh akses baca minimum untuk kebutuhan task berikutnya.
- Test menjalankan SQL terhadap PostgreSQL lokal dengan `psql` di container Supabase sehingga policy diuji sebagai role `authenticated`, bukan dilewati oleh koneksi admin.

## Task List

### Phase 1: Local Foundation

- [x] Tambahkan Supabase CLI, konfigurasi lokal, script `db:reset`/`db:advisors`, dan test harness database sebelum migration tersedia.

### Checkpoint: Foundation

- [x] Local stack dapat dimulai dan test database mengeksekusi SQL pada database lokal.

### Phase 2: Schema dan Security

- [x] Tambahkan enum, tabel, constraint, dan index seluruh model data.
- [x] Tambahkan RLS minimum, privilege minimum, immutability attendance, dan audit foundation.
- [x] Tambahkan seed development deterministik tanpa credential atau data production.

### Checkpoint: Schema dan Security

- [x] Reset dari database kosong berhasil.
- [x] Constraint, index, seed, dan isolasi lintas-user lulus integration test.

### Phase 3: Completion

- [x] Jalankan advisors dan command verifikasi T02.
- [x] Tinjau perubahan, centang T02, dan perbarui `MEMORY.md` bila semua gate berhasil.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Policy terlihat benar tetapi koneksi test bypass RLS | Tinggi | Test memakai `SET ROLE authenticated` dan JWT claim per user. |
| Reset lokal tidak deterministik | Tinggi | Seed memakai UUID/nilai tetap dan verifikasi menjalankan reset penuh. |
| Constraint versi efektif terlalu lemah | Sedang | Gunakan exclusion constraint rentang tanggal per jenis aturan dan test overlap. |
| Advisor menghasilkan temuan karena FK/policy | Sedang | Index seluruh FK dan kolom policy, lalu jalankan advisors sebelum menandai selesai. |

## Open Questions

- Tidak ada; detail schema dan batas akses cukup ditentukan oleh PRD, TechDesign, TASKS, dan instruksi repository.
