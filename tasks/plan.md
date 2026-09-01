# Implementation Plan: T15 E2E dan Release Readiness

## Overview

Menambahkan harness Playwright yang menjalankan smoke test MVP melalui API dan UI nyata, command hosted Supabase yang terkunci ke project `jlqzeytwwdnooepagknb`, bootstrap SuperAdmin berbasis environment secret, serta dokumentasi deployment tanpa menyimpan credential atau mereset/seed database hosted.

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

- Akses CLI aktif menampilkan project target `jlqzeytwwdnooepagknb`, tetapi environment belum menyediakan database password/key/credential smoke. Gate hosted tetap terbuka sampai credential environment yang sesuai tersedia.

---

# Active Extension: Upah Bulanan dan Pulang Awal

Kebijakan ini telah disetujui dan sedang diselesaikan sebagai bagian release readiness T15. Dashboard admin tetap memakai GUI upah berversi yang sama; formula, kontrak, laporan, dan workflow pulang awal ditambahkan tanpa halaman konfigurasi duplikat.

## Confirmed Inputs

- Jadwal Senin–Jumat tetap `05:30 / 07:00 / 08:00 / 12:00 / 15:35 / 17:00`, target 515 menit.
- Jadwal Sabtu tetap `05:30 / 07:00 / 08:00 / 09:30 / 10:35 / 12:00`, target 215 menit.
- Geofence sekolah: latitude `-8.1328`, longitude `113.2219`.
- Upah dasar bulanan awal adalah Rp600.000, bukan tarif kerja per jam.
- Tidak hadir tanpa keterangan dikenai potongan sehari penuh sebesar Rp20.000 (`Rp600.000 / 30`).
- Lupa checkout hanya dicatat dan tidak menghasilkan potongan upah.
- Check-in setelah `07:00` sampai batas `08:00` dikenai potongan tetap Rp10.000, satu kali per hari terlambat.
- Pulang awal tidak langsung dipotong. Guru mengajukan permohonan kepada admin; permohonan disetujui memberi kredit jam kerja penuh, sedangkan permohonan ditolak membuat waktu dari pengajuan sampai jam kerja selesai menjadi waktu kosong.
- Aturan upah harus berversi efektif agar nilai upah bulanan dan potongan satu jam dapat berubah dari tahun ke tahun.

## Recommended Formula

Potongan keterlambatan adalah Rp10.000 per kejadian. Durasi kosong akibat permohonan pulang awal yang ditolak bernilai proporsional Rp10.000 per 60 menit berdasarkan durasi sebenarnya, kemudian dibatasi agar total potongan satu hari tidak melebihi Rp20.000.

```text
dailyAbsenceDeduction = monthlyBasePerformancePay / 30

untuk setiap hari kerja:
  jika tidak hadir tanpa keterangan:
    dayDeduction = dailyAbsenceDeduction
  jika hadir:
    lateDeduction = arrivalLateMinutes > 0 ? Rp10.000 : Rp0
    jika permohonan pulang awal disetujui:
      earlyDepartureDeduction = Rp0
      creditedWorkedMinutes = targetMinutes
    jika permohonan pulang awal ditolak:
      rejectedEmptyMinutes = max(0, workEnd - requestedAt)
      earlyDepartureDeduction = rejectedEmptyMinutes * (Rp10.000 / 60)
    dayDeduction = min(Rp20.000, lateDeduction + earlyDepartureDeduction)
  jika lupa checkout:
    dayDeduction = lateDeduction saja; lupa checkout tidak menambah potongan

totalDeduction = jumlah dayDeduction
finalPerformancePay = max(Rp300.000, monthlyBasePerformancePay - totalDeduction)
```

- Tepat `07:00` tidak terlambat; `07:01`–`08:00` dihitung satu kejadian terlambat.
- Satu hari hanya dapat menghasilkan satu potongan keterlambatan Rp10.000, tanpa memperhitungkan jumlah menit terlambat.
- Pengajuan pulang awal harus mencatat `requestedAt` dari waktu server serta snapshot lokasi. Timestamp tidak boleh dikirim atau diubah Guru maupun admin.
- Pengajuan menjadi penanda keberangkatan aktual. Admin hanya dapat menyetujui atau menolak dampaknya terhadap kredit jam kerja.
- Persetujuan pulang awal memberi kredit target menit penuh untuk kekurangan pulang awal, tetapi tidak menghapus potongan keterlambatan yang sudah terjadi pada hari tersebut.
- Penolakan membuat interval `requestedAt` sampai `workEnd` menjadi waktu kosong. Rekomendasi monetisasinya proporsional: 30 menit = Rp5.000, 60 menit = Rp10.000, dan 90 menit = Rp15.000.
- Keterlambatan dan waktu kosong pulang awal yang ditolak dijumlahkan, tetapi total potongan hari tersebut direkomendasikan maksimal Rp20.000.
- Tidak hadir tanpa keterangan memakai potongan Rp20.000 saja dan tidak ditumpuk dengan jenis potongan lain.
- Lupa checkout tidak membuat potongan tambahan. Jika pada hari itu Guru juga terlambat, potongan keterlambatannya tetap berlaku.
- Izin/sakit yang disetujui, Minggu, dan hari libur tidak menghasilkan potongan.
- Upah akhir tidak boleh kurang dari Rp300.000.

Contoh: terlambat 3 hari menghasilkan potongan `3 × Rp10.000 = Rp30.000`, sehingga upah akhir Rp570.000. Pulang 90 menit lebih awal dengan permohonan disetujui tidak menambah potongan; jika ditolak, rekomendasi potongannya Rp15.000. Jika hari yang sama juga terlambat, hasil Rp25.000 dibatasi menjadi Rp20.000. Alpa satu hari menghasilkan potongan Rp20.000 saja. Lupa checkout tanpa keterlambatan menghasilkan potongan Rp0.

## Architecture Decisions

- Pertahankan `payroll_rules` sebagai konfigurasi global berversi; jangan mengubah row historis in-place.
- Tambahkan mode kalkulasi eksplisit agar versi legacy bulanan/per-menit tetap reproduktif, sedangkan versi baru memakai `monthlyBasePerformancePay`, `lateDeductionAmount`, potongan alpa harian, serta durasi kosong pulang awal yang ditolak.
- Buat workflow `early_departure_requests` terpisah dari izin harian karena Guru sudah check-in. Hanya satu permohonan aktif per absensi; reason wajib, waktu/lokasi dicatat server, dan keputusan admin diaudit.
- Permohonan berstatus Pending memblokir ekspor final bulan tersebut, seperti izin Pending, agar hasil upah tidak berubah setelah laporan dikunci.
- Kontrak Zod dibuat lebih dahulu, kemudian migration/RPC, perhitungan laporan, dan GUI admin mengikuti kontrak yang sama.
- Backend menghitung `lateDayCount`, potongan, dan upah final. Angular dan Excel hanya menampilkan hasil backend.

## Dependency Graph

`Persetujuan formula -> PRD/TechDesign -> kontrak -> migration/RPC -> kalkulator laporan -> GUI admin -> E2E/ekspor`

## Task List

### Phase 1: Domain dan Kontrak

- [x] Setujui konversi durasi kosong proporsional, batas potongan harian Rp20.000, dan batas bawah upah Rp300.000.
- [x] Perbarui PRD/TechDesign serta kontrak payroll dengan upah bulanan, potongan telat Rp10.000, alpa, lupa checkout, serta workflow permohonan pulang awal.

**Acceptance:** schema menolak kombinasi field antarmode yang tidak valid dan contoh hitung tepat waktu/terlambat menghasilkan nilai yang disetujui.

**Verification:** contract tests dan unit tests kalkulator baru dibuat gagal dahulu lalu diluluskan oleh implementasi.

### Phase 2: Persistensi Berversi

- [x] Buat migration additive melalui `supabase migration new`; pertahankan kolom/formula legacy untuk histori.
- [x] Perbarui function pembuatan versi, audit before/after, mapping Supabase, dan resolusi aturan per bulan.

**Acceptance:** versi baru menutup versi lama, tidak overlap, hanya efektif tanggal 1, dan laporan lama tetap memakai aturan lamanya.

**Verification:** `npm run db:reset`, pgTAP/integration tests, dan `npm run db:advisors`.

### Phase 3: Kalkulasi dan Laporan

- [x] Hitung potongan per hari dari domain attendance: telat Rp10.000, durasi kosong permohonan pulang awal yang ditolak, alpa, serta lupa checkout tanpa potongan tambahan.
- [x] Sesuaikan preview dan kontrak laporan dengan rincian penyebab; ekspor tetap memakai empat baris total template tetapi seluruh nilainya berasal dari backend baru.

**Acceptance:** API preview dan XLSX menghasilkan angka identik untuk 0, 1, dan banyak hari terlambat.

**Verification:** monthly-report dan Excel tests untuk bulan 28/29/30/31 hari serta lebih dari 56 guru.

### Phase 4: GUI Dashboard Admin

- [x] Adaptasi form payroll yang sudah ada menjadi `Upah dasar bulanan`, `Upah minimum`, `Potongan keterlambatan`, nilai satu jam kosong, potongan alpa, dan `Mulai berlaku`.
- [x] Tambahkan form Guru untuk alasan pulang awal dan antrean admin untuk approval/rejection dengan status yang jelas.
- [x] Tampilkan ringkasan versi aktif serta penjelasan formula dalam Bahasa Indonesia.

**Acceptance:** admin dapat membuat versi tahun/bulan berikutnya, field tervalidasi, klik ganda dicegah, dan versi historis tidak dapat diedit.

**Verification:** Angular component/service tests, lint, typecheck, build, serta cek desktop/mobile.

### Phase 5: Release

- [ ] Jalankan E2E konfigurasi upah -> keterlambatan -> preview -> ekspor dan deploy migration hosted melalui dry-run/advisors.

**Acceptance:** hosted smoke membuktikan nilai potongan dan upah final yang sama pada GUI, API preview, dan ekspor.

**Verification:** seluruh release gate lokal dan hosted tanpa reset/seed remote.

## Open Questions Before Implementation

- Tidak ada; formula telah disetujui untuk diimplementasikan.
