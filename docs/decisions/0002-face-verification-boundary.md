# ADR 0002: Batas keputusan Face Verification dan private inference

- Status: accepted untuk batas arsitektur; model dan enforcement belum diputuskan
- Tanggal: 2026-10-01

## Konteks

`FACE_VERIFICATION_PLAN.md` mengusulkan camera/landmark/challenge di browser dan keputusan di backend. Runtime aktual adalah Angular dan Express pada satu Cloudflare Worker, dengan `packages/contracts`, sesi aplikasi, PostgreSQL Supabase, dan jalur absensi termasuk Pulang Awal. Model biometrik tidak cocok ditempatkan di isolate Worker. Audit sebelumnya menyepakati Guru saja, enrollment mandiri, pilot non-enforcing, template dihapus saat akun dinonaktifkan, dan inference privat di luar Worker.

## Keputusan

- Angular boleh mengelola kamera, landmark, quality gate, dan tampilan challenge, tetapi seluruh sinyal browser adalah bukti tidak tepercaya. Browser hanya memanggil API satu origin; tidak memiliki URL, credential, atau akses langsung ke inference service/database.
- Express/Worker memvalidasi sesi aplikasi dan role/status Guru, menciptakan challenge acak terikat user/aksi dan kedaluwarsa, membatasi ukuran/jumlah frame dan percobaan, mengikat request idempotency, serta memegang keputusan final termasuk geofence, aturan absensi, dan pencatatan.
- Private inference service memiliki identitas service-to-service, jaringan terbatas, TLS, timeout, concurrency limit, model warm-up dan health check. Service ini mengembalikan hasil teknis one-face/PAD/embedding-match beserta versi model dan waktu proses; tidak menerima service key Supabase, tidak mengakses tabel absensi, dan tidak menulis hasil absensi.
- Sampel biometrik dan embedding tidak dicatat pada log umum. Bukti mentah hidup hanya selama request kecuali retensi khusus disetujui; template terenkripsi dan penghapusannya saat akun nonaktif adalah kebutuhan fase berikutnya.
- Jalur check-in, checkout, dan Pulang Awal harus tercakup sebelum enforcement. Satpam tetap memakai jalur lama. Pilot Guru pertama tidak memblokir absensi, tetapi desain akhir harus fail-closed setelah kebijakan go-live diputuskan.

## Konsekuensi

- Tidak perlu mengganti stack atau auth. `packages/contracts` kelak mendefinisikan schema Zod public dan internal sebelum wiring; Phase 1 baru mendokumentasikan batas semantik.
- Tambahan network hop dan cold start menjadi risiko nyata untuk target UX 2–5 detik. Wajib benchmark perangkat dan jalur end-to-end sebelum memilih model, threshold, ukuran frame, timeout, atau kapasitas.
- Enrollment mandiri memerlukan mitigasi account takeover dan prosedur recovery; belum ada otorisasi untuk mengaktifkannya.
- Challenge browser saja tidak membuktikan liveness. Backend/inference harus mengevaluasi urutan bukti yang diterima; tingkat ketahanannya tetap perlu pengujian replay/print/screen/mask.
- Tidak ada perubahan perilaku, API, database, atau dependency dalam ADR/Phase 1 ini.
