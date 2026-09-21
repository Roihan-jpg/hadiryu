# T15 Checklist

- [x] Playwright dan Chromium smoke project terpasang serta dikonfigurasi.
- [x] Guardrail script hosted menolak project ref/URL yang tidak sesuai dan tidak memuat reset/seed remote.
- [x] `.env.production.example` hanya berisi placeholder/non-secret.
- [x] Bootstrap SuperAdmin membaca NIP, nama, dan password hanya dari environment.
- [x] Local E2E mencakup setup, Guru login/ganti password, check-in/checkout, izin, approval, preview, dan ekspor.
- [x] Hosted smoke memakai credential khusus dari environment dan tidak membuat/menimpa akun secara otomatis.
- [x] Dokumentasi environment/deployment menyertakan dry-run, advisors, dan larangan reset/seed hosted.
- [x] Seluruh verification gate lokal lulus setelah perubahan upah bulanan/pulang awal.
- [x] Repository dapat dihubungkan ke project Supabase dari environment dan migration history local/remote dapat diverifikasi.
- [x] Migration awal dan remediation advisors berhasil diterapkan tanpa reset/seed remote.
- [x] Migration upah bulanan/pulang awal berhasil diterapkan tanpa reset/seed remote.
- [x] Advisors hosted pascamigration baru lulus tanpa warning atau temuan kritis.
- [x] Bootstrap SuperAdmin dan siapkan akun Guru khusus smoke melalui input secret.
- [x] Smoke hosted lulus sampai preview dan ekspor laporan.
- [x] Review akhir selesai; T15 dan `MEMORY.md` diperbarui dengan pengecualian warning Free Plan yang disetujui pemilik project.

## Extension T15: Upah Bulanan dan Pulang Awal

- [x] Audit implementasi saat ini: GUI payroll berversi sudah tersedia di dashboard admin.
- [x] Pertahankan jadwal awal: target weekday 515 menit dan Sabtu 215 menit.
- [x] Catat geofence `-8.1328,113.2219` dan model upah bulanan dikurangi nominal satu jam per hari terlambat.
- [x] Konfirmasi upah dasar bulanan Rp600.000, potongan alpa Rp20.000/hari, dan lupa checkout hanya dicatat.
- [x] Konfirmasi potongan keterlambatan tetap Rp10.000 dan pulang awal memakai workflow permohonan dengan approval/rejection admin.
- [x] Setujui konversi durasi kosong proporsional, batas potongan harian Rp20.000, dan upah minimum Rp300.000.
- [x] Implementasikan kontrak dan migration payroll additive dengan kompatibilitas formula legacy.
- [x] Integrasikan kalkulator backend, preview, dan ekspor.
- [x] Adaptasi GUI payroll, tambahkan pengajuan pulang awal Guru serta antrean approval admin, dan tambahkan test.
- [x] Jalankan release gate lokal/hosted tanpa reset atau seed remote.
