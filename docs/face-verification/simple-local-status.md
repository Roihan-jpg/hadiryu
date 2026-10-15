# Verifikasi wajah sederhana lokal — 12 Oktober 2026

Implementasi lokal tersedia. Acceptance kamera manusia, wajah orang lain, dan 20 pemeriksaan nyata masih menunggu pengguna; jangan menandai fitur siap produksi atau seluruh acceptance selesai.

## Keputusan dan alur

Permintaan pengguna 12 Oktober menggantikan rencana Phase 3 kompleks. Guru mendaftar sekali dengan konfirmasi password dan tiga frame depan setelah menekan Daftarkan wajah. Absen Masuk/Pulang membuka kamera dan GPS bersamaan, mengirim satu frame, lalu Express mengenali wajah akun yang login dan menjalankan aturan absensi/geofence existing. Pulang Awal dan Satpam tetap existing. Production/Worker tidak diaktifkan.

Tidak ada blink/turn/pose sequence/PAD pada mode SIMPLE_LOCAL. Foto/video wajah dapat menipu sistem; ini recognition-only, bukan liveness atau bukti anti-spoof. Identitas tidak dicari pada seluruh Guru.

## Model dan runtime

- SFace FP32 2021dec dan YuNet FP32 2023mar; weights/checksum sama dengan fondasi existing.
- Pipeline `local-simple-sface2021dec-yunet2023mar-v2-7d769bd5e91cf5aa`; manifest `services/face-inference/simple-model-manifest.json` berstatus EVALUATION.
- Python 3.12; OpenCV contrib 4.13.0.92; NumPy 2.5.3; Pillow 12.3.0. Dependency image legacy tetap terpasang, tetapi MediaPipe dan ONNX Runtime tidak diimport/dimuat oleh pipeline sederhana. Probe runtime nyata memastikan keduanya false.
- YuNet threshold 0,8, kotak minimal 96×96; SFace alignment/embedding ternormalisasi; cosine minimum 0,363. [Referensi SFace](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/sface.py). Angka ini belum dikalibrasi pada pengguna sekolah.
- Model dimuat/checksum/warm-up sekali per proses. Private loopback/mTLS, satu worker, batas 2 CPU/2 GiB, processing 10 detik, upload 15 detik, request keseluruhan 30 detik.

## Database dan keamanan

Migrations tambahan, tanpa reset data:

1. `20261012010000_simple_face_local.sql`: profil recognition-only dengan PAD null yang eksplisit, enrollment mode tanpa challenge, sesi absensi user/auth-session/purpose/template/model-bound dengan TTL 90 detik; backend-only RPC/grants dan RLS.
2. `20261012011000_simple_face_atomic_response.sql`: penyimpanan record, response hasil domain, keberhasilan sesi, dan audit dalam transaksi yang sama. Adapter repository menyiapkan payload dengan domain existing; tidak menulis sebelum transaksi final. Replay mengembalikan response tersimpan.

Claim atomik. Status akun, sesi login, revision password, template/model dan expiry diperiksa lagi sebelum commit. Akun disabled mempertahankan template DISABLED; daftar ulang tetap menggunakan grant existing dan membuat template lama REVOKED. Model/key mismatch jelas membutuhkan daftar ulang. Rate limits tetap aktif: enrollment existing, issuance absensi 10 per 5 menit per Guru.

API sederhana menggunakan `/api/face/enrollment/*` existing dan `/api/attendance/face/sessions` serta `/api/attendance/face/submit`. Endpoint absensi lama menolak Guru ketika mode lokal aktif; Satpam tetap lewat alur existing. Body tidak menerima userId, target identity, match decision, atau score. Gambar dibatasi 640×480/256 KiB, MIME/signature/decode/animation/decompression checks. Browser tidak menerima embedding atau template. AES-256-GCM/AAD/key di Express tetap dipakai. Satu foto depan enrollment disimpan terenkripsi atas permintaan pengguna terbaru; frame lainnya dibuang. Tidak ada foto atau material biometrik pada log/audit.

## Verifikasi baseline sebelum update oval/foto

- Migration up lokal: PASS, data tidak di-reset.
- Seluruh pgTAP: 140 assertions/7 files PASS, termasuk 17 assertions grant/RLS/RPC baru.
- API/domain/database: 331 tests/63 files PASS, termasuk claim paralel, owner mismatch, wajah berbeda (inference double), lokasi luar zona, expired, disabled/password-change during inference, dan rollback ketika audit gagal. Pengujian memakai aktor unik dan cleanup milik test.
- Frontend: 202 tests/39 files PASS; E2E browser mobile/laptop 8 PASS. E2E memakai kamera sintetis Chromium dan API fixture, bukan biometrik manusia.
- Inference: 21 tests PASS, termasuk corrupted/oversized/decompression image, checksum, simple frame counts, inconsistent identity, busy/timeout/restart.
- HTTPS smoke nyata (aktor sementara milik test): login/status/konfirmasi password 200, corrupted enrollment frame 422 INVALID_IMAGE, bypass endpoint legacy 409 FACE_VERIFICATION_REQUIRED; seluruh fixture dibersihkan. Bukan acceptance kamera manusia.
- Transport nyata: 3 PASS, designated Express mTLS/source identity/readiness, tanpa sertifikat/sertifikat lain/Origin ditolak; corrupt input concurrency 1/5/10 tidak menjadi sukses. Bukan benchmark concurrency wajah nyata.
- Setup 11, release config 10, Worker 2 PASS. Lint/typecheck/build PASS; target16 tests sederhana diulang pada source final dan PASS; warning RouterLink/budget/Lottie/JSDOM existing tetap tercatat.

## Pengukuran yang tersedia

Benchmark baseline pipeline v1, sebelum update oval/foto: 20 siklus komponen sintetis dengan model nyata, 2 CPU/2 GiB: cold-load + warm-up 7.097 ms, p50 91,58 ms, p95 99,51 ms, CPU total 3,54 detik, peak RSS 182,61 MiB. Snapshot container siap 183,2 MiB. Ini memanggil detector dan recognition pada input sintetis, bukan 20 verifikasi wajah manusia atau waktu end-to-end; target p95 ≤5 detik nyata belum dinyatakan lulus. Waktu GPS diukur terpisah saat uji perangkat.

## Pemakaian dan acceptance tersisa

Project utama tidak dijalankan ulang oleh Codex pada update ini. Proses API/Angular/inference yang sudah aktif sejak 21:15 dibiarkan untuk pengguna; uji browser memakai server sementara port4201 dengan API fixture. Pengguna menjalankan `npm run face:local` sendiri untuk membangun source terbaru, menerapkan migration yang belum diterapkan dan mendaftarkan profil v2. Buka halaman Pendaftaran wajah, konfirmasi password, buka kamera, posisikan wajah di oval dan tekan Daftarkan wajah. Versi lama memerlukan izin daftar ulang existing; template lama tidak dihapus. Setelah terdaftar, lakukan absensi pada jadwal/lokasi valid.

Untuk HP saat ini: `https://10.19.213.199:4200/guru/face-enrollment`, lalu `/guru/absen`, pada Wi-Fi yang sama. Sertifikat browser untuk IP ini sudah disiapkan; CA existing harus dipercaya HP. Jika IP berubah, `npm run face:prepare -- <IP Wi-Fi>` memperbarui sertifikat browser; jangan menghapus template.key atau men-reset database. Laptop harus tetap aktif.

Belum ditutup: pendaftaran manusia Redmi Note 14 5G/laptop, check-in/checkout nyata, penolakan wajah orang berbeda, 20 warm verifications nyata beserta upload/server/GPS timing. Deployment production, hosting selalu online, dataset/provenance/consent/retention dan threshold evaluasi sekolah tetap di luar penerapan lokal ini.

## Files changed untuk perubahan sederhana

Contracts: `simple-face.ts`, `attendance.ts`, `face-enrollment.ts`, `index.ts`.
API: `simple-face.ts` beserta empat file spec; `app.ts`, `server.ts`, `attendance.ts`, `supabase-attendance.ts`, `face-inference-client.ts`.
Web: `camera-session.ts`/spec terkait, `capture-frame.ts`, `simple-face-camera.ts`, enrollment page TS/HTML, attendance service, home page TS/HTML.
Inference: `simple_pipeline.py`, `simple-model-manifest.json`, `simple_benchmark.py`, `test_simple_pipeline.py`, `identity.py`, `server.py`.
Launcher/transport: `face-local.mjs`, `face-inference-transport.test.mjs`; E2E config/spec; kedua migrations dan `simple-face.test.sql`; PRD/TechDesign/TASKS/MEMORY/FACE_VERIFICATION_PLAN dan laporan ini. Perubahan lain sebelumnya milik pengguna dipertahankan.

## Batas cakupan verifikasi otomatis

API command mencakup semua unit/regression dan owned-fixture suites, mengecualikan `src/*-supabase.spec.ts`, `src/database.spec.ts`, `src/security-audit-supabase.spec.ts` yang bergantung konfigurasi/seed lama. Seluruh SQL tests tetap dijalankan lewat `supabase test db` (140 PASS), serta enrollment/database milik fitur baru memakai aktor unik. Default `npm test`/`test:e2e` tidak dijalankan karena target manual tidak di-reset/diganti seed. E2E face-ui merupakan browser+API fixtures, bukan full biometric/attendance production E2E.

Fixture yang tertinggal dari diagnosis test pertama dibersihkan hanya pada9 aktor sintetis dengan marker nama/NIP/id dan waktu penciptaan yang diverifikasi; akun dan absensi pengguna tidak dihapus. Tidak ada commit/deployment hosted.


## Update oval, submit dan foto admin (12 Oktober 2026)

Permintaan pengguna terbaru mengizinkan penyimpanan satu foto depan enrollment untuk dialog edit Guru. Pusat bbox YuNet harus dalam 10% lebar/tinggi gambar dari pusatnya, hanya pada enrollment. Kamera menunggu tombol Daftarkan wajah, mengambil tiga frame selama sekitar satu detik, lalu memberi efek capture dan checkmark setelah status ACTIVE tersimpan; reduced-motion didukung. Tidak ditambahkan challenge/PAD.

Migration `20261012144040_face_enrollment_reference_portraits.sql` menambah foto AES-256-GCM (AAD purpose/owner/template/model/MIME), RLS/grants backend-only dan composite FK template/owner. Penyimpanan foto/template/session/audit satu transaksi. API foto hanya SuperAdmin aktif, no-store/nosniff. Dialog edit mencabut object URL pada penutupan dan mencegah hasil request terlambat membuat URL baru. Foto enrollment lama tidak dapat dibuat ulang dari embedding; tampilkan empty state. Penggantian template tetap memerlukan izin admin existing.

Verifikasi update: migration up lokal PASS tanpa reset; pgTAP150/8 files PASS; targeted API15 PASS (enkripsi/otorisasi HTTP/transaksi database); frontend206/40 files PASS; inference23 PASS; E2E10 PASS pada mobile/laptop dengan kamera/gambar sintetis dan API fixture (termasuk foto admin dan submit manual). Lint/typecheck/build PASS dengan warning existing RouterLink/budget/Lottie/JSDOM. Ini bukan bukti acceptance wajah manusia.

API regression tambahan final: 334 tests/64 files PASS, termasuk perubahan photo/enrollment dan domain absensi. Command mengecualikan legacy config/seed-dependent suites yang dijelaskan di atas. Tidak ada reset data pengguna.
