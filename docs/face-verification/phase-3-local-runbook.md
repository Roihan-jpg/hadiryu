# Uji Phase 3 di laptop dan Android

Port private inference kini dipilih otomatis oleh Docker pada127.0.0.1, untuk menghindari port yang dicadangkan Windows. Express dan transport tests menemukan mapping dari container milik task. Port internal tetap9443; pengguna tetap membuka URL kamera4200. Tidak perlu mengubah firewall/reservasi port Windows. Jangan menjalankan face:local kedua ketika aplikasi lokal masih berjalan; gunakan aplikasi yang sudah aktif atau hentikan launcher lama dahulu.

Tindak lanjut terbaru 2026-10-09: pipeline4 menampilkan tahap yang ditolak PAD dan mencatat apakah seluruh/sebagian frame gagal, tanpa menyimpan foto/skor. Perbaikan input pipeline3 belum menyelesaikan penolakan HP. Threshold tetap; diagnosis baru bukan klaim bahwa enrollment genuine sudah berhasil. Gunakan satu percobaan setelah refresh untuk membedakan masalah gerakan dengan penolakan model pada pose stabil; batas percobaan tetap berlaku.

Gunakan checkout `D:\absensi-guru`. Semua command berikut lokal. Jangan memakai credential hosted. Absensi tidak membutuhkan wajah pada Phase 3.

## Persiapan

1. Nyalakan Docker Desktop dan tunggu engine siap.
2. Di terminal repository: `npx supabase start --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit`. CLI dapat menampilkan key lokal; jangan menyalinnya ke chat atau log.
3. `npm run face:prepare`. Ini build runtime terpin, download/checksum weights, menyiapkan private TLS dan key enkripsi. Ulangi dengan `npm run face:prepare -- 192.168.x.x` bila IP Wi-Fi laptop berubah. Jangan menghapus `.cache/face/template.key` bila ingin membaca template lama.
4. `npm run face:account` di terminal interaktif: pilih `SUPER_ADMIN` dan buat akun lokal sendiri. Jalankan lagi, pilih `USER` untuk Guru Anda. Password dimasukkan tersembunyi, sesuai aturan existing delapan karakter alfanumerik dengan huruf besar/kecil/angka. Akun/NIP existing tidak ditimpa. Tidak ada password disimpan ke file.
5. `npm run face:local`, biarkan terminal berjalan. Buka `https://localhost:4200`. URL Android memakai IP Wi-Fi laptop yang ditampilkan saat prepare, misalnya `https://192.168.1.7:4200`.

HTTPS memerlukan sertifikat CA yang dipercaya perangkat. CA **publik** terdapat di `.cache/face/browser/hadiryu-local-ca.crt`; jangan membagikan file `.key`, folder private/server, atau template key. Pada Windows, impor CA itu ke Trusted Root **Current User** melalui certificate manager. Pada Android, transfer CA publik melalui USB lalu pilih pengaturan keamanan → install certificate → CA certificate (nama menu berbeda menurut perangkat). Hanya pasang CA yang Anda verifikasi berasal dari laptop sendiri. Root CA lokal ini untuk evaluasi dan boleh dihapus dari trust store setelah selesai; sertifikat berlaku 30 hari. Jangan memasang private CA inference ke browser.

Android dan laptop harus satu Wi-Fi, dengan HTTPS yang dipercaya dan permission kamera. Jika firewall meminta akses, batasi dev server port 4200 pada jaringan Private lokal. Port host inference otomatis tetap loopback, dengan mTLS. Jangan expose Supabase/API/inference ke internet.

## Enrollment nyata

Pembaruan terbaru 2026-10-09: input model anti-spoof mengikuti margin/resize referensi original model pada pipeline3, tanpa melonggarkan threshold. Panduan menunjukkan progres, pesan "Sudah pas" ketika tolehan terbaca, dan instruksi kembali ke depan bila masih menghadap sisi sebelumnya. Setelah pose terakhir, gambar langsung diperiksa otomatis. Service lokal diperbarui pada sesi perbaikan; muat ulang HP sebelum mencoba. Keberhasilan PAD/perangkat belum terbukti. Overlay pilihan Anda tetap hanya tampilan, bukan filter pada gambar untuk server.

Login sebagai Guru lokal → Profil Saya → Pendaftaran wajah (evaluasi). Baca pemberitahuan, isi password, mulai kamera. Ikuti challenge acak kedip/toleh, lalu tahan pose depan/kiri/kanan. Kamera berhenti sebelum server memeriksa bukti. Catat apakah status ACTIVE dan pesan sukses tampil.

Untuk uji perangkat kedua **dengan akun yang sama**, login SuperAdmin lokal → Guru & Satpam → Izin daftar ulang pada Guru tersebut. Konfirmasi hanya setelah Anda memeriksa identitas. Grant berlaku 24 jam dan sekali sukses. Login Guru pada perangkat kedua lalu ulangi. Template pertama menjadi REVOKED, yang baru ACTIVE. Jangan menghapus template atau mematikan limit untuk mempermudah pengujian.

`NOT_ENROLLED` / **Belum terdaftar** berarti belum ada template tersimpan. Guru dapat mencoba pendaftaran pertama langsung dari **Profil Saya → Pendaftaran wajah (evaluasi)**; tidak perlu izin SuperAdmin. Izin daftar ulang hanya untuk mengganti template setelah pendaftaran pernah berhasil. Halaman **Latihan verifikasi wajah** adalah latihan Phase 2 dan tidak menyimpan template.

Sesuai klarifikasi Anda 2026-10-07, pratinjau kedua halaman mengikuti sisi tubuh: tangan kiri dan toleh kiri muncul di kiri layar. Ini mode mirror pada tampilan video saja; gambar yang dianalisis dan dikirim ke server tetap tidak dibalik. Ikuti langkah 1–5 sampai instruksi berganti; untuk kedipan, tutup kedua mata sebentar lalu buka saat diminta. Toleh sedikit dan tahan HP stabil, tanpa memutar ke profil samping penuh. Panduan menganalisis resolusi gambar kiriman, maksimal 640×480, dengan JPEG quality 0,85. Server tetap memeriksa sendiri seluruh bukti; tidak mempercayai panduan browser.

Bila muncul `QUALITY_FAILED`, bersihkan lensa, gunakan cahaya merata dari depan, jaga wajah di tengah dan HP stabil. `PAD_FAILED` berarti model anti-spoof menolak bukti; gunakan kamera langsung tanpa filter, kemudian catat kode dan langkah terakhir bila tetap gagal. Pesan ini tidak membuktikan pengguna melakukan spoof. Threshold evaluasi belum terkalibrasi pada perangkat nyata dan tidak dilonggarkan untuk memaksakan PASS. Tetap catat percobaan yang gagal.

Pembaruan 2026-10-07 memasang frame transparan pilihan Anda pada pratinjau; frame tidak ikut dianalisis/dikirim dan teks tidak mirror. Gerakan kecil diukur dari pose depan Anda, dengan toleransi satu sampel bergeser dalam jendela lima; tahan sebentar hingga instruksi berganti. Ini membantu pose, tetapi bukan jaminan model PAD akan menerima perangkat Anda.

Service lokal sudah dibangun ulang dan dijalankan dengan pipeline2 pada sesi perbaikan ini. Cukup muat ulang halaman HP untuk mencoba lagi. Bila menjalankan checkout ini kembali setelah perubahan inference: hentikan launcher lama dengan Ctrl+C, jalankan `docker build -t hadiryu-face:local services/face-inference`, lalu `npm run face:local` dan muat ulang HP. Launcher mendaftarkan versi baru tanpa menimpa versi lama. Akun, key/template dan counter tetap dipertahankan; tidak perlu membuat akun atau sertifikat ulang. Template versi lama tetap mengikuti pathway REENROLLMENT_REQUIRED, tanpa comparison diam-diam.

Bila gagal, catat hanya perangkat/browser, kode error, langkah terakhir dan waktu kasar. Jangan kirim foto, embedding, password, ciphertext, atau skor. Periksa pencahayaan/jarak kamera, mulai sesi baru. Lima kegagalan password/15 menit dan lima submission/jam tetap berlaku.

## Checklist manual (belum dinyatakan lulus)

- [ ] Android: consent, reauth, challenge, tiga pose dan enrollment sukses; kamera berhenti.
- [ ] Laptop: grant reviewed dan enrollment sukses; template lama REVOKED.
- [ ] Cancel/navigasi/permission denied membersihkan kamera.
- [ ] Challenge tidak dilakukan, statis, arah/urutan salah ditolak.
- [ ] Wajah berbeda antar-bukti ditolak.
- [ ] Print, layar dan replay sederhana dicoba dan hasil dicatat secara jujur; ini tidak membuktikan spoof resistance umum.
- [ ] Disabled → template DISABLED; aktivasi tidak mengaktifkan template lama; review/re-enrollment diperlukan.
- [ ] Check-in, checkout dan Pulang Awal berjalan dengan flow existing tanpa Face Verification.

## Pengukuran dan penutupan

`npm run test:inference` memeriksa media/temporal/version/supervisor boundaries. Dengan runtime aktif, `node --test scripts/face-inference-transport.test.mjs` memeriksa mTLS dan overload negatif 1/5/10. `npm run face:benchmark` menghasilkan 100 pengukuran synthetic component cycle dengan model nyata; **bukan benchmark enrollment nyata**.

Acceptance rencana masih memerlukan ≥100 warm sample **enrollment nyata**, p50/p95/p99, cold/warm-up, upload dan end-to-end, CPU/peak RSS, bytes, timeout, concurrency 1/5/10. Jangan merekayasa hasil dari test doubles/gambar sintetis atau menonaktifkan counter/single-use. Dataset/protokol pengambilan bukti yang sah dan evaluasi itu belum dijalankan; hasil kamera awal diperlukan dahulu untuk mengetahui kelayakan pipeline dan threshold. Semua evidence tetap memory-only; measurement yang disimpan hanya metadata agregat.

Phase 3 belum boleh dicentang hanya karena UI/model hidup. Setelah semua gate otomatis dan manual/benchmark terpenuhi, perbarui laporan `phase-3-status.md` serta TASKS/MEMORY. Tidak ada Phase 4/enforcement otomatis.

Untuk regresi tampilan setelah akun/enrollment manual tersedia, gunakan `npm run test:e2e:face-ui`. Runner ini memakai port 4201 dan mock seluruh API; tidak mereset atau menulis database. Viewport HP/laptop di Chromium menguji UI, bukan membuktikan enrollment biometrik pada Android/laptop nyata.

Hentikan dengan Ctrl+C pada terminal launcher, lalu `npm run face:stop` untuk memastikan container inference berhenti. `npm run test:e2e` mereset database lokal dan meninggalkan konfigurasi/data smoke. Jalankan suite database/API dari seed lokal bersih **sebelum E2E**, atau reset lokal lagi sebelum rerun suite tersebut. Jangan menjalankan reset setelah enrollment manual bila ingin mempertahankan hasil Anda.
