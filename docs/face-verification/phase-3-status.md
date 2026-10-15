# Phase 3 — Enrollment and Private Inference

> Phase 3 kompleks dihentikan/digantikan atas permintaan pengguna 12 Oktober 2026, bukan dinyatakan lulus. Implementasi baru: [laporan sederhana](simple-local-status.md).

## Hasil percobaan terbaru masih gagal — 2026-10-10

Sesudah perbaikan diagnosis dan pelepasan overlay, metadata20menit menunjukkan satu PAD_FAILED_SOME_FRAMES_MIXED pada pipeline5, satu QUALITY_FAILED, satu SESSION_REPLACED dan satu ISSUED. Ini bukti sebagian frame melewati PAD, sementara rejection mencakup model probability real<=0,5 serta >0,5 tetapi <0,9. Bukan penolakan seluruh frame lagi, tetapi tetap tidak membuat template. Tidak mengambil foto/embedding/skor atau identitas akun. Kategori ini tidak menentukan tahap yang ditolak; detail stage hanya ada dalam respons UI, bukan audit/session. Jangan menyimpulkan hanya motion frames atau mengubah policy tanpa bukti. Maximum jumlah claimed attempts peruser satu jam saat query adalah5; tidak reset/meniadakanlimit. Layar HP tidak dapat dibaca lewat screen context desktop. Menunggu nama tahap pada pesan Ditolak pada dari pengguna; Phase3 belum selesai.

## Bingkai gambar dilepas — koreksi terbaru 2026-10-10

Pengguna mengoreksi permintaan sebelumnya: tidak memakai frame/filter gambar. Elemen img.face-frame beserta CSS overlay dihapus pada enrollment dan latihan. PNG sumber tidak dihapus, tetapi tidak dipakai pada kamera. Panduan teks/progres, preview/video/mirror/sizing, capture/canvas, model/PAD/session/privasi dan absensi tetap. Tidak ada migration/dependency/restart inference/API. Angular lokal hotreload. Files: dua HTML, dua SCSS dan dua spec halaman, e2e/face-ui.spec.ts serta PRD/TechDesign/TASKS/MEMORY/laporan. Empat E2E mobile/laptop mengecek active state tanpa overlay/kamera terlihat/nooverflow PASS;11testfrontend/lintfull+targetedspec/typecheck/build/diffcheck PASS. ProbeHTTPS aktual dengan fixture tanpa wajah manusia: overlayPresent:false, progress50, previewmirror/nooverflow/notice otomatis tetap; bukan acceptance kamera manusia. Warning build RouterLink/budget/Lottie dan JSDOMpause existing. Koreksi ini menggantikan keputusan fill di bawah, tidak mengatasi PAD genuine yang masih terbuka. FV-P3unchecked, absensi tidak berubah.

## Bingkai memenuhi area kamera — 2026-10-10

Pengguna meminta frame memenuhi kotak kamera hingga tepinya. PNG941×1672 sebelumnya dirender object-fit:contain di kotak4:3 sehingga isi gambar menyempit di tengah. Overlay pada enrollment dan latihan sekarang object-fit:fill, tetap inset0/width100%/height100%, tanpa mirror/klik; proporsi tampilan mengikuti kotak kamera. Bukan fullscreen halaman. Tidak mengedit PNG atau mengganti sizing video, capture/landmarks/model/preprocessing/PAD/session/absensi. Files: dua SCSS halaman, e2e/face-ui.spec.ts dan dokumen ini/PRD/TechDesign/TASKS/MEMORY. Test browser expectedfill direproduksi RED pada contain, lalu4E2E mobile/laptop GREEN; lint/typecheck/build/diffcheck PASS. ProbeHTTPS aktual dan pemeriksaan screenshot fixture tanpa manusia menunjukkan frame melebar/nooverflow/preview tetapmirror; bukan uji kamera manusia. Warningbuildexistingtetap. Live Angular hotreload, inference/API tidak direstart; port3000/4200 aktif/container running/noOOM. Perubahan ini tidak membuktikan genuine PAD berhasil. FV-P3 tetapunchecked.

## Diagnosis Redmi Note 14 5G — 2026-10-10, pipeline5

Pengguna mengidentifikasi perangkat sebagai Redmi Note 14 5G. Artefak di container nyata: 12.270.179 bytes, SHA384 sesuai [konfigurasi resmi OMZ2022.1.0](https://github.com/openvinotoolkit/open_model_zoo/blob/2022.1.0/models/public/anti-spoof-mn3/model.yml), input float32 [1,3,128,128], output float32 [1,2]. Tidak ditemukan salah artefak/channel/class. Identitas perangkat bukan bukti bahwa kamera rusak, filter aktif, atau bahwa model kompatibel dengan perangkat.

Metadata lama hanya menunjukkan skor di bawah 0,9, tanpa membedakan prediksi spoof/uncertain dari prediksi real yang belum mencapai threshold. Pipeline5 memperbaiki celah diagnosis: rejectionKind enum MODEL_NOT_REAL/BELOW_ACCEPTANCE/MIXED, tanpa nilai skor, disertai counts tahap yang sudah ada. Output model yang bukan pasangan probabilitas normalized ditolak. UI menjelaskan kategori BELOW_ACCEPTANCE; Express menyimpan kategori sebagai suffix failureCode saja. Setiap rejection tetap menggagalkan sesi, tidak ada voting/bypass atau template commit. Threshold/model/weights/preprocessing/session/resource limits/enkripsi/RLS/absensi tetap. Tidak ada migration atau dependency baru. Tidak menyimpan foto atau embedding untuk diagnosis; kategori tidak membuktikan spoof sebenarnya.

Verifikasi selesai: reproduction RED lalu GREEN; 26 API pada empat suite termasuk transaksi/race/ownership realDB dan audit kategori-only; 17 inference; 9 frontend; 4 E2E UI fixture mobile/laptop; lint/typecheck/build/diffcheck PASS. Live launcher session79754 memuat pipeline5-a034e327945aa92d, registry immutable/migration applied:[], tanpa reset DB/key/cert/akun/counters. Probe awal sebelum warm-up masih503; setelah readiness berubah, smoke client Express dan tiga actual mTLS/transport PASS. UIprobe HTTPS aktual PASS. Snapshot255,9MiB/2GiB,CPU0,11%,OOMKilled=false; bukan peak usage. Corrupt-input burst1/5/10:26,12/130,91/495,63ms; bukan latency enrollment genuine. Warning build existing RouterLink/budget/Lottie tetap. Hasil kamera manusia, kalibrasi genuine/spoof dan benchmark enrollment nyata belum tersedia; Phase3 tetap terbuka. Tiga percobaan historis tidak dapat dihitung ulang karena evidence transient sudah dibuang.

## Genuine enrollment tetap ditolak — 2026-10-10

Setelah startup berhasil, pengguna melaporkan tiga percobaan yang flow kamera dapat diselesaikan tetapi ditolak. Metadata realDB satu jam terakhir menunjukkan tiga PAD_FAILED_ALL_FRAMES: setiap frame gagal batas PAD, termasuk pose depan/kiri/kanan yang diam. Ini mempersempit masalah dari dugaan frame gerak saja ke penilaian seluruh input kamera. Tidak menyimpulkan pengguna spoof, tidak mengambil foto/embedding/skor, dan tidak menyatakan liveness server sudah lolos; rejection PAD terjadi sebelum validasi temporal/identity final.

[Spesifikasi release OMZ2022.1.0](https://github.com/openvinotoolkit/open_model_zoo/blob/2022.1.0/models/public/anti-spoof-mn3/README.md) dan [konfigurasi artefak release yang sama](https://github.com/openvinotoolkit/open_model_zoo/blob/2022.1.0/models/public/anti-spoof-mn3/model.yml) mengonfirmasi RGB, NCHW128, mean/scale dan class0-real yang digunakan. Tidak ditemukan bukti baru untuk membalik channel/class atau mengganti weights. Threshold0,9 masih engineeringdefault, bukan hasil kalibrasi perangkat. Perlu evaluasi transient genuine/spoof untuk membedakan preprocessing/domain kamera dan threshold/model feasibility; all-frames-failed belum memberikan nilai confidence yang diperlukan. Tidak menurunkan batas atau mengubah model secara diam-diam. Ulang gerakan berkali-kali bukan solusi untuk hasil ini. Identitas perangkat/merek/model belum tersedia, dan acceptance Phase3 tetap terbuka.

## Startup Windows — 2026-10-10

Full repository lint selesai PASS setelah verifikasi port; typecheck/build dan seluruh checks yang tercantum di bawah PASS. Layanan lokal aktif dan dipertahankan berjalan, belum menandai acceptance enrollment genuine selesai.

Error terbaru terjadi sebelum enrollment: Docker gagal bind127.0.0.1:9443. Bukti aktual netsh ipv4 excludedportrange menunjukkan9433–9532 dicadangkan Windows; tidak ada listener9443 dan container berada pada stateCreated. Tidak menghapus rentang cadangan, restart jaringan, mengubah firewall, atau memakai privilege admin.

Perbaikan: launcher publish127.0.0.1::9443; Docker memilih hostport tersedia. Helper baru scripts/face-local-port.mjs memvalidasi ownerlabel face-local, tepat satu binding127.0.0.1, port1–65535 dengan Zod. Express menerima origin hasil discovery lewat FACE_INFERENCE_ORIGIN; client tetap HTTPSloopback+mTLS. Transport tests menggunakan helper yang sama; test port masuk gate test:release-config/npmtest. Port internal9443 dan kamera4200 tetap. Pada startup nyata hostport9853 berhasil; angka ini snapshot saja dan bisa berubah.

Files berubah pada fix ini: scripts/face-local.mjs, scripts/face-local-port.mjs, scripts/face-local-port.test.mjs, scripts/face-inference-transport.test.mjs, apps/api/src/server.ts, package.json serta TechDesign/TASKS/MEMORY/runbook/laporan. Tidak ada perubahan model/weights/version4/PAD0,9/liveness/session/schema/RLS/grant/enkripsi/absensi. Migration applied:[], tidak reset data, key atau certificate.

Verifikasi PASS: dua testport termasuk actualnativeephemeralbind dan penolakan publichost/multibinding/foreignowner/invalidports;10testrelease-config; clientunit;3actualmTLS/transport pada discoveredport; smoke PrivateFaceInferenceClient.ready() aktual dengan certificateExpress/sourceversion; targetedESLint, typecheck, build, diffcheck dan UIprobe HTTPS lokal dengan APIfixture tanpa kamera manusia. Readiness probe pertama terjadi sebelum warm-up dan503; setelah warm-up identity/caller tests seluruhnyaPASS. Model tetap load-once; tidak menganggap503 sebagai hasil sukses. Port aplikasi3000/4200 listening, container2CPU/2GiB/OOMKilled=false. Warning build existing RouterLink/budget/Lottie tetap. Scope ini memperbaiki startup, bukan membuktikan genuine PAD pada HP sudah berhasil; FV-P3 tetapunchecked.

## Tindak lanjut penolakan HP — 2026-10-09, pipeline4

Pengguna menyelesaikan gerakan tetapi tetap gagal setelah pipeline3. Metadata sebelum perubahan ini: tujuh PAD_FAILED, sembilan SESSION_REPLACED, satu QUALITY_FAILED. Tidak tersedia foto atau skor percobaan lama karena evidence tidak disimpan. Penyebab false rejection belum dapat ditentukan dan enrollment genuine belum dinyatakan berhasil.

Perbaikan diagnosis: pipeline4-c0b058979b2457b3 mengevaluasi seluruh bukti setelah PAD rejection untuk menghasilkan lima kelompok {stage,evaluated,rejected}: challenge server yang acak dan pose depan/kiri/kanan. Satu rejection tetap menggagalkan seluruh sesi sebelum template dibuat; tidak ada majority voting, pengabaian motion frames, penurunan PAD0,9, atau penggantian model. Error schema strict membatasi kategori/count dan melarang score/image/embedding; Express memeriksa urutan/count terhadap input claim server. UI menampilkan nama tahap yang ditolak tanpa angka biometrik. Audit/session hanya mencatat PAD_FAILED_ALL_FRAMES atau PAD_FAILED_SOME_FRAMES bersama versi model yang sudah ada. Frame tetap in-memory dan buffer pixel dibersihkan; processing10s/body/frame/account/session/race limits tetap.

Bug runtime yang ditemukan saat verifikasi: Vite prebundle masih memuat export kontrak lama; serve kini mengecualikan @absensi/contracts sehingga halaman enrollment dapat dibuka kembali. Launcher start/serve sebelumnya tidak membangun ulang Docker image ketika source berubah; kini build terjadi sebelum mengganti container milik task. Warm-up lewat45s di bawah beban build sebelumnya meninggalkan worker hidup namun unready permanen; supervisor kini menghentikan child pada timeout dan mencoba startup maksimal tiga kali. Startup normal tetap load-once, pemrosesan10s tetap, kegagalan tidak menjadi sukses.

Verifikasi terbaru PASS: 25 API pada empat suite termasuk real DB/race/rollback dan audit tanpa material, satu rerun client boundary setelah validasi diagnostics terhadap request, sembilan enrollment frontend, lima belas inference (RED→GREEN), empat E2E UI mobile/laptop (cache bug direproduksi dahulu), lint/typecheck/build, tiga actual mTLS/transport. Probe UI di HTTPS lokal memakai fixture API tanpa kamera manusia: asset941px/overlay tidak mirror/video mirror/tidak overflow/progress50/informasi otomatis tampil. Ini bukan acceptance biometrik.

Layanan live dibangun ulang dan actual readiness cocok dengan source hash pipeline4. Migration applied:[], tanpa reset DB/key/cert/akun/counter. Snapshot257,2MiB/2GiB, duaCPU,CPU0,09%,OOMKilled=false; bukan peakRSS. Burst corrupted transport concurrency1/5/10 ditolak dalam30,47/102,12/180,67ms; bukan latency enrollment genuine. Latency end-to-end enrollment dan benchmark100warm nyata pipeline4 belum tersedia. Peringatan build existing RouterLink/budget/Lottie masih ada. Tidak ada dependency/schema/RLS/grant/absensi/deployment berubah.

Files pada tindak lanjut ini: packages/contracts/src/face-enrollment.ts; services/face-inference/{pipeline,policy,server,test_pipeline,test_supervisor}.py dan model-manifest.json; apps/api/src/{face-inference-client,face-inference-client.spec,supabase-face-enrollment,supabase-face-enrollment.spec,face-enrollment.contract.spec}.ts; apps/web/src/app/features/face-enrollment/{face-enrollment-page,face-enrollment-page.spec}.ts; apps/web/angular.json; scripts/face-local.mjs; PRD.md/TechDesign.md/TASKS.md/MEMORY.md dan laporan/runbook Phase3.

Langkah yang masih perlu: satu uji HP setelah refresh untuk memperoleh diagnosis tahap; evaluasi genuine dan spoof diperlukan sebelum kalibrasi threshold/policy. UI yang lancar tidak membuktikan model PAD cocok dengan kamera ini. FV-P3 tetap unchecked; laptop/Android genuine, spoof/replay, benchmark dan open decisions production tetap terbuka. Phase4 tidak dimulai dan Face Verification tidak diwajibkan pada absensi.

Checkout `D:\absensi-guru`, implementasi berdasarkan rencana lokal yang disetujui 2026-10-06. **Implementasi lokal tersedia; Phase 3 belum selesai sampai seluruh gate otomatis, enrollment kamera Android/laptop dan benchmark enrollment nyata terpenuhi.** Tidak ada deployment hosted, enforcement absensi, atau Phase 4.

## Arsitektur dan keputusan

Angular HTTPS → Express loopback → Python Docker loopback HTTPS/mTLS. Hanya Express memakai service key dan menyimpan template. Inference tidak menerima Supabase config/key, password aplikasi atau template encryption key. Sertifikat leaf Express ditunjuk secara spesifik; caller tanpa cert, cert lain dari CA sama, dan Origin browser ditolak.

Satu child process memuat seluruh model sekali, memverifikasi weights SHA256 dan runtime lalu warm-up. Health/readiness terpisah. Concurrency satu, tambahan ditolak INFERENCE_BUSY tanpa antrean panjang. Processing 10 detik; child macet dihentikan/diganti dan warm-up ulang. Upload Express 15 detik, client inference 12 detik, deadline submit 30 detik; kegagalan tidak membuat template baru.

Container non-root UID 10001, read-only filesystem/mounts, tanpa capabilities, no-new-privileges, tmpfs 32 MiB, 2 CPU/2 GiB, PID limit 64. Key server POSIX 0600 dimiliki UID inference; CA/Express/template private keys tidak dimount ke container. Launcher membatasi ACL cache Windows ke pemilik dan SYSTEM.

Bukti teknis baru: Docker Desktop pada laptop tidak mempublikasikan port network --internal. Dipakai bridge terpisah dari Supabase, publish 127.0.0.1:9443 dan mTLS. Ini membatasi inbound, **bukan pemblokiran egress**. Container tidak memiliki driver/kode database. Production private connectivity tetap OPEN DECISION.

## Model dan versi

Shortlist Phase 1 tetap **EVALUATION**, tidak dinyatakan approved production. YuNet mendukung alignment SFace; Face Landmarker sama dengan foundation kamera. Manifest lengkap di `services/face-inference/model-manifest.json`.

| Fungsi | Model | Weights | SHA256 |
|---|---|---|---|
| Recognition | SFace 2021dec | 2021dec FP32 | 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79 |
| PAD | anti-spoof-mn3 MN3_large | OMZ 2022.1 | c4c99af04603b62d7e44f6f4daeb33e0daeccc696008c0b1d62f6f5cebbb3262 |
| Alignment | YuNet 2023mar | 2023mar FP32 | 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4 |
| Temporal | Face Landmarker | float16/1 | 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff |

Python 3.12 (patch terukur 3.12.15); OpenCV contrib 4.13.0.92; ONNX Runtime CPU 1.30.0; MediaPipe 1.0.1; NumPy 2.5.3; Pillow 12.3.0. Wheels dikunci versi/hash (`requirements.lock`); image Python dipin digest. Tidak memakai paket OpenCV ganda. Compatibility smoke memerlukan library sistem EGL/GLES walaupun inference CPU; library ditambahkan tanpa mengganti kandidat/runtime.

ID actual terbaru: `local-sface2021dec-mn3-2022.1-pipeline3-b9fab9675f069520`. Hash mencakup manifest, pipeline/preprocessing, policy, identity dan dependency lock. Registry mencatat full manifest/hash dan menolak perubahan identitas model existing. Perubahan menghasilkan versi baru dan pathway re-enrollment; benchmark pipeline1 dan hasil pipeline2 di bawah tetap bukti historis versi masing-masing.

Preprocessing mengacu pipeline resmi [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface), [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet), [anti-spoof-mn3](https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/public/anti-spoof-mn3). Label lisensi manifest mengikuti studi Phase 1; provenance dataset/penggunaan biometrik sekolah tetap harus disetujui sebelum production.

## Enrollment dan keamanan

Guru aktif login, membaca pemberitahuan lokal dan mengonfirmasi password aplikasi. Backend tidak membuat sesi login tambahan. Database menerbitkan sesi ENROLLMENT milik user dan hash cookie login, TTL 120 detik, reauth maksimal 60 detik. Challenge acak kedip + arah toleh, urutan acak. Browser mengirim dua burst 8–24 frame dan tiga pose depan/kiri/kanan; tidak menerima/menentukan target userId, purpose, skor atau verdict.

Inference mengevaluasi ulang wajah tunggal, kualitas/blur, challenge temporal, PAD, pose dan konsistensi embedding semua frame. Embedding tiga pose dirata-rata dan dinormalisasi, 128 dimensi. Express mengenkripsi AES-256-GCM dengan nonce acak; AAD mengikat format, userId, templateId dan modelVersion. Key di luar DB. Envelope mencatat key ID/version, nonce/tag, model version, timestamps/status.

Frame hanya diproses di memory: tidak ada Storage upload, foto fixture dalam repo, atau persistensi. Batas 60 frame, 640×480, 256 KiB/frame, agregat compressed 2,8 MiB dan body 4 MiB. Validasi MIME/signature/format decoder, canonical base64, dimensi/pixel abuse, animasi, corrupted image dan timeout. Managed memory tidak menjanjikan secure erase semua salinan string, meskipun buffer plaintext dibersihkan.

Claim atomic dan DB counter: lima kegagalan password/15 menit, lima submission/jam/Guru. Pemeriksaan ulang role/akun/login/password revision/expiry/model/grant dilakukan saat claim dan commit. Parallel/reused/expired session ditolak. Logout/password reset/deaktivasi saat inference mencegah commit. Template–session–grant–audit diselesaikan satu transaksi; audit gagal membatalkan template.

Akun disabled membekukan ACTIVE→DISABLED, mencabut login/grant dan membatalkan enrollment atomik, termasuk account path tanpa flag lokal. Aktivasi akun tidak memulihkan template. SuperAdmin mereview identitas, memberi grant 24 jam; grant hanya untuk Guru dengan template existing dan dikonsumsi sekali saat sukses. Replacement membuat template lama REVOKED dan baru ACTIVE. Tidak ada auto-delete; hard-delete backend tetap memungkinkan kebijakan retensi akhir.

Versi berbeda atau key/cipher tidak dapat dibaca menghasilkan REENROLLMENT_REQUIRED, tanpa silent comparison. Status hanya metadata aman. Application/audit log tidak menerima image, embedding, ciphertext, credential atau raw scores. RLS aktif, PUBLIC/anon/authenticated tidak mendapat grants/policy biometrik. RPC SECURITY INVOKER, execute service_role saja; [referensi RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## API dan UI

- GET /api/face/enrollment/status
- POST /api/face/enrollment/sessions — password confirmation
- POST /api/face/enrollment/submit — evidence tanpa userId target
- GET /api/face/enrollment/sessions/:id — metadata terminal untuk pemulihan jaringan
- POST /api/admin/teachers/:id/face-reenrollment — SuperAdmin, identityReviewed=true

Cookie app-auth, Guru aktif saja, CSRF mutation dan rate limit. UI /guru/face-enrollment terpisah dari absensi, link Profil pada host lokal; consent/reauth sebelum kamera, double-click guard, cleanup saat cancel/error/navigasi, kamera berhenti sebelum upload. Admin grant tidak mengunggah wajah atas nama Guru. Default aplikasi/Worker tidak mengaktifkan enrollment dan mengembalikan ENROLLMENT_UNAVAILABLE.

## Files changed

- Kontrak: packages/contracts/src/face-enrollment.ts, export index.ts; API contract/log spec.
- API: face-enrollment.ts, supabase-face-enrollment.ts, face-inference-client.ts, face-template.ts; wiring app.ts/server.ts; auth.ts structured body limit; teachers.ts/supabase-teachers.ts lifecycle; observability.ts redaction.
- API tests: face-enrollment.contract.spec.ts, face-enrollment.http.spec.ts, face-template.spec.ts, supabase-face-enrollment.spec.ts.
- Angular: features/face-enrollment/*; core/local-evaluation.ts; routes; profile link; admin Teachers grant UI/service/spec.
- Runtime: services/face-inference/{Dockerfile,.dockerignore,model-manifest.json,requirements.in,requirements.lock,identity.py,policy.py,pipeline.py,server.py,prepare_local.py,benchmark.py,test_policy.py,test_pipeline.py,test_supervisor.py}.
- Tooling: scripts/face-local.mjs, face-local-account.mjs, face-inference-transport.test.mjs; npm scripts/ignore artefak lokal; e2e/local-release.spec.ts regression.
- DB: migrations di bawah; face-enrollment.test.sql dan face-enrollment-runtime.test.sql.
- Docs: laporan ini/runbook/measurements, PRD/TechDesign/TASKS/MEMORY. Root docs tetap ignored sesuai konfigurasi existing. Perubahan user/Phase 2 dipertahankan.

## Migrations (hanya lokal)

1. 20261005165228_fv_p3_enrollment_foundation.sql — registry/envelope/session, privacy audit guard; foundation tidak ditulis ulang.
2. 20261005174612_fv_p3_enrollment_runtime.sql — durable counters/grants, owner FK, transaksi/RPC.
3. 20261005181655_fv_p3_model_manifest.sql — full manifest dan immutable model identity.
4. 20261006062739_fv_p3_lifecycle_hardening.sql — grant hanya replacement; freeze pada semua deactivate path.
5. 20261006065159_fv_p3_preserve_account_auth_behavior.sql — pencabutan login tambahan hanya untuk akun dengan state enrollment; perilaku penolakan autentikasi akun existing dipertahankan.

## Verifikasi dan measurement

Hasil final diisi setelah gate. Gangguan Docker mati/temp setup lokal bukan PASS; test tidak dihapus/dilemahkan/disengaja skip.

| Gate | Status |
|---|---|
| Clean migrations, pgTAP, advisors | PASS — 123 assertions, enam file; no issues |
| Full API/ownership/race/audit rollback | PASS — 344 API tests, termasuk 10 DB security/race dan 6 HTTP enrollment |
| Inference decoder/temporal/startup/supervisor | PASS — 8 tests |
| mTLS transport + concurrency 1/5/10 | PASS — 3 tests, workload negatif |
| Lint/typecheck/build | PASS |
| npm test | PASS — 344 API, 188 web, 11 setup, 8 release configuration, 2 Worker |
| E2E absensi existing + enrollment unavailable | PASS — satu smoke lokal, 56.1 detik (runner 1.7 menit) |
| Android/laptop enrollment dan spoof/replay manual | Enrollment HP sudah dicoba, BELUM LULUS; laptop/spoof/replay belum terverifikasi |
| 100 warm enrollment nyata/upload/E2E/resources | BELUM DIUKUR |

face:benchmark mengukur 100 synthetic component cycles dengan model nyata pada gambar abu-abu. **Bukan latency enrollment nyata, akurasi identity/PAD, atau bukti target UX 2–5 detik tercapai.** Transport overload memakai corrupted evidence, bukan pengguna nyata. Measurements hanya metadata, tanpa foto/embedding/skor.

Hasil lokal 2026-10-06, versi actual `local-sface2021dec-mn3-2022.1-pipeline1-bc5ac4a3d8e54e8b`: cold-start + warm-up 8.529 detik; synthetic cycle p50 171.46 ms, p95 276.73 ms, p99 345.49 ms; CPU agregat 36.10 detik untuk 100 cycle; peak process RSS 329.40 MiB. Container dibatasi 2 CPU/2 GiB dan run keluar normal tanpa OOM. Data lengkap `phase-3-measurements.json`. Durasi burst corrupted input concurrency 1/5/10: 44.39/200.58/320.61 ms; seluruh request ditolak, tidak ada busy yang teramati pada input secepat ini. Mutex/busy/hard-timeout/restart diuji terpisah dengan declared supervisor test double. Peak RSS dan concurrency enrollment nyata belum diukur.

Review independen menemukan grant pre-enrollment yang bisa tersisa untuk replacement berikutnya dan key server yang terbaca umum pada POSIX. Keduanya diperbaiki; test grant denial dan real mTLS lulus. Trigger deaktivasi disesuaikan agar akun tanpa state enrollment mempertahankan respons autentikasi existing. Test upload menunggu socket siap dan memverifikasi error 15 detik; test tambahan mengikat keseluruhan submit ke 30 detik termasuk upload. Fixture expiry memakai satu titik waktu dan memeriksa update sukses: dua Date.now terpisah sebelumnya bisa melanggar TTL 120 detik dan membuat fixture belum expired. Suite akhir memakai seed bersih karena smoke E2E meninggalkan konfigurasi/data yang memengaruhi beberapa test existing. Tidak ada test yang dilemahkan. Warning existing RouterLink/bundle budgets/lottie dan keterbatasan jsdom video.pause tetap ada; tidak menjadi kegagalan gate. `git diff --check` lulus.

## Tindak lanjut uji HP 2026-10-06

Pengguna melaporkan enrollment HP tidak pernah berhasil, status NOT_ENROLLED dan pesan exception umum saat SuperAdmin meminta daftar ulang. Pemeriksaan metadata database lokal mendapati dua submission PAD_FAILED, satu QUALITY_FAILED, lima sesi diganti, satu ISSUED, dan nol template. Ini bukti penolakan nyata, bukan bukti spoof oleh pengguna atau keberhasilan enrollment. Browser/letak hambatan challenge masih diminta dari pengguna; foto, embedding dan skor tidak dikumpulkan.

Perbaikan terbatas pada UX/capture dan pesan API:

- Hilangkan transform mirror pada latihan Phase 2; enrollment diberi transform none eksplisit. Kiri/kanan mengikuti tubuh, dijelaskan juga arah hidung pada layar.
- Panduan kedip membedakan buka–tutup–buka dan menampilkan langkah 1–5. Instruksi ditempatkan sebelum kamera, tinggi preview dibatasi untuk HP. Urutan, kualitas dan arah yang salah tetap tidak bisa menyelesaikan challenge.
- Browser menganalisis canvas pada resolusi kiriman, bukan feed native yang bisa 1920×1080. JPEG quality naik dari 0,65 menjadi 0,85 untuk mengurangi hilangnya detail; seluruh ceiling frame/body tetap berlaku. Dampak terhadap PAD/blur pada perangkat nyata masih harus diuji, bukan diasumsikan.
- Status NOT_ENROLLED tampil sebagai Belum terdaftar, dengan petunjuk bahwa pendaftaran pertama tidak memerlukan grant SuperAdmin. REENROLLMENT_NOT_NEEDED tetap HTTP 409 dan menolak grant, tetapi memberi pesan khusus yang sama di API/UI; kebijakan replacement tidak berubah.
- PAD_FAILED/QUALITY_FAILED/POSE_FAILED/CHALLENGE_FAILED mendapat petunjuk spesifik tanpa menampilkan skor. Model, preprocessing inference, threshold, counter, reauth, session/RLS dan perilaku absensi tidak berubah. Tidak ada migration atau model/weights baru.

RGB, mean/scale dan label real kelas 0 untuk ONNX original diperiksa terhadap [spesifikasi resmi anti-spoof-mn3](https://github.com/openvinotoolkit/open_model_zoo/blob/master/models/public/anti-spoof-mn3/README.md); tidak ditemukan bukti bahwa kanal/label terbalik. Ambang engineering PAD 0,9 dan blur 80 tetap belum tervalidasi pada perangkat pengguna. Penolakan PAD belum dapat dinyatakan selesai hanya dari perbaikan UI/capture ini.

Test regresi pesan/phase capture dan resolusi analisis terlebih dahulu gagal sebelum perbaikan. Verifikasi terbaru PASS: 192 test frontend (39 file), 21 test API terkait enrollment (termasuk 10 DB security/race dan 6 HTTP boundary), 28 pgTAP enrollment/RLS/grants (dua file, rollback), 8 inference, lint, typecheck, build dan git diff --check. Empat test `test:e2e:face-ui` lulus pada viewport HP/laptop dengan seluruh API dimock pada port 4201, tanpa reset atau akses database. Ini regresi UI, bukan bukti PAD atau enrollment nyata. Gate full-suite/smoke historis di tabel sebelumnya berasal dari implementasi awal; full smoke absensi yang mereset database tidak diulang pada data manual pengguna. Metadata sesi dan jumlah template pengguna sama sebelum/setelah verifikasi.

Files tindak lanjut: face-enrollment-page.ts/html/scss/spec.ts; face-challenge-page.html/scss; teachers-page.ts/spec.ts; supabase-face-enrollment.ts/spec.ts; e2e/face-ui.config.ts dan face-ui.spec.ts; package.json; runbook/laporan dan root PRD/TechDesign/TASKS/MEMORY.

## Klarifikasi orientasi pratinjau 2026-10-07

Pengguna menjelaskan bahwa tangan kiri harus muncul di kiri layar, lalu mengonfirmasi preferensi tersebut. Ini menggantikan permintaan non-mirror sebelumnya untuk tampilan kamera saja. Video latihan dan enrollment memakai CSS scaleX(-1); copy dan instruksi toleh kiri/kanan mengikuti tampilan. Canvas tetap mengambil feed native tanpa scale/translate, sehingga gambar/analisis/yaw/kontrak/model/inference server tidak berubah. Tidak ada migration, threshold, enforcement absensi atau deployment production.

E2E diperbarui untuk preferensi terbaru dan terlebih dahulu gagal pada preview none sebelum perubahan. Test capture juga memeriksa drawImage feed native tanpa scale/translate. Verifikasi PASS: 192 test frontend, empat E2E UI viewport HP/laptop, lint, typecheck, build dan git diff --check. Browser QA pada service https://localhost:4200 juga memverifikasi mirror CSS di dua halaman dengan API dimock tanpa meminta kamera. Full smoke reset/database tidak diulang untuk perubahan preview ini. Perubahan tampilan bukan bukti enrollment/PAD berhasil, dan Phase 3 tetap belum selesai.

## Acceptance, keputusan terbuka, readiness

Verifikasi non-mirror terdahulu 2026-10-07 (sebelum klarifikasi orientasi di atas): empat E2E face-ui PASS; service lokal https://localhost:4200 memiliki transform none pada video/ancestor. Seluruh API dimock, tanpa meminta kamera atau mengambil frame. Hasil ini historis dan preferensi tampilan telah diganti oleh klarifikasi tangan kiri tampil di kiri layar, bukan acceptance biometrik.

Phase 3 dicentang hanya setelah seluruh gate otomatis, successful encrypted enrollment Android dan laptop, penolakan challenge salah/statis/wajah berbeda, serta uji print/layar/replay sederhana dicatat. Benchmark nyata minimal 100 warm samples harus mencatat p50/p95/p99, upload/E2E, CPU/peak RSS/bytes, timeout dan concurrency 1/5/10, tanpa OOM dan overload terkontrol. Hasil spoof lokal tidak membuktikan ketahanan umum.

## Overlay dan pose kecil — 2026-10-07

Bagian ini merekam pipeline2; perbaikan pipeline3 terbaru tercatat di bagian berikutnya.

Pengguna melaporkan tidak pernah melewati pose kiri dan meminta gambar face-frame.png sebagai panduan. PNG sumber 941×1672 sudah transparan; disalin tanpa edit ke apps/web/public/assets/face-enrollment/face-frame.png, SHA256 15d7149d1d8436367a510f5c946bf65c14bdd155aaa0ac8ef580559e01d738f4. .gitignore mengecualikan PNG panduan dari ignore artefak model; weights tetap ignored. Overlay img hanya tampil saat CAPTURING/ACTIVE, object-fit:contain, pointer-events:none, teks tidak mirror. Canvas hanya menggambar video native; tidak ada filter pada bukti visual atau pengumpulan foto pengguna. Browser QA pada HTTPSlocalhost4200 dengan semua API mocked juga memeriksa asset941px, overlay transform:none, video mirror, tanpa overflow, lalu inspeksi visual frame kosong tanpa wajah.

Test signal double mereproduksi browser/server menolak delta kecil 0,135, serta capture mengulang hitungan karena satu sampel jitter. Sesuai permintaan terbaru, batas turnYawMinimum turun 0,18→0,12 untuk challenge dan pose. Pose kiri/kanan sekarang memakai delta dari frame depan, bukan posisi hidung absolut, dan membutuhkan empat sampel cocok dalam lima sampel terakhir dengan sampel terakhir wajib valid. Pose netral <0,1 dan delta maksimum <0,45; diam, arah terbalik, urutan salah, kualitas buruk dan pose berlebihan tetap ditolak. Nilai tersebut adalah rasio landmark, bukan sudut atau hasil kalibrasi perangkat. PAD0,9/blur80/cosine0,363, model/weights/runtime/preprocessing tidak berubah.

Perubahan policy menghasilkan versi immutable pipeline2-82dcde96963a5d05; Docker dibangun ulang, launcher lokal dihentikan berdasarkan ancestry/path yang diperiksa, lalu dijalankan lagi. Registry versi baru ditambahkan tanpa menimpa versi lama; startup tidak menerapkan migration tambahan. Key/sertifikat/akun/counter/data manual dipertahankan. Real mTLS readiness cocok dengan hash source baru; tidak ada silent comparison template lama.

Verifikasi PASS: 196 web/39 file; 20 API/5 file (enrollment HTTP/kontrak, enkripsi template, challenge); 10 Python; 3 actual mTLS/transport termasuk version identity; 4 E2E UI viewport HP/laptop; lint, typecheck, build, git diff --check. E2E overlay memakai declared camera-state fixture dan mock semua API, tanpa kamera manusia; memeriksa asset asli loaded, teks tidak dibalik, bounds, pointer-events dan overflow. Test kecil/pose/overlay terlebih dahulu gagal sebelum implementasi. Python pose memakai declared signal/vector doubles; bukan bukti acceptance wajah nyata.

Snapshot Docker sesudah startup/test: 257,4 MiB dari limit2GiB, 2CPU, OOMKilled=false. Burst corrupt-input concurrency1/5/10: 15,53/68,96/83,59ms dan seluruhnya ditolak; bukan latency enrollment nyata atau peak RSS. Benchmark pipeline1 tidak dipindahkan ke versi baru. Warning build existing (budget, RouterLink, Lottie/CommonJS/eval) tetap tercatat. Full DB-reset/attendance E2E tidak dijalankan pada data manual; tidak ada schema/grant/absensi berubah. Phase3 tetap terbuka sampai acceptance perangkat dan benchmark nyata terpenuhi.

## Panduan kanan dan input PAD — 2026-10-09

Pengguna melaporkan langkah kelima masih sulit tetapi akhirnya berpindah ke pemeriksaan server, lalu anti-spoof menolak. Metadata lokal tanpa user ID/biometrik menunjukkan lima PAD_FAILED, satu QUALITY_FAILED dan sembilan SESSION_REPLACED; dua submission gagal berada dalam satu jam terakhir saat inspeksi. Data ini bukan bukti pengguna melakukan spoof dan tidak menentukan frame/penyebab false rejection. Tidak mengambil foto, embedding atau skor pengguna.

UI kini menunjukkan poseProgress, pesan "Sudah pas" saat gerakan terbaca, "Kembali hadap depan" bila masih menghadap arah berlawanan, dan koreksi saat terlalu jauh. Setelah empat sampel cocok, pose dikonfirmasi sudah diambil; halaman menjelaskan sejak awal bahwa pemeriksaan otomatis dimulai setelah langkah terakhir. Pesan PAD menyatakan hasil belum dapat dipastikan dan template belum tersimpan, dengan evaluasi admin bila berulang. Kontrak/gerakan0,12/four-of-five/session/attempt limit tidak berubah.

Bukti teknis baru: [FaceDetector/TorchCNN referensi original model](https://github.com/kprokofi/light-weight-face-anti-spoofing/blob/82a2c26bacff5462c6f9320c34ae0363ccbed497/demo_tools/wrapers.py) memperluas detector-box 1,1 pada lebar dan 1,05 pada tinggi, serta memakai INTER_CUBIC untuk resize original/PyTorch input. Pipeline sebelumnya memakai crop ketat dan resize default INTER_LINEAR. [Spesifikasi original ONNX](https://github.com/openvinotoolkit/open_model_zoo/tree/master/models/public/anti-spoof-mn3) mengonfirmasi RGB/mean/scale/class0-real sebelumnya sudah benar; bagian itu tetap. Training dan demo converted/OpenVINO dapat memakai preprocessing berbeda; perubahan ini menyelaraskan jalur original yang dipakai dengan referensi TorchCNN, bukan mengklaim kesetaraan accuracy semua runtime/detektor.

Pipeline3-b9fab9675f069520 menyimpan padPreprocessing dengan reference commit terpin dan preprocessingVersion rgb-pad-reference-margin-cubic-sface-align-v2. Crop margin diclip ke decoded image; blur dan SFace tetap memakai input sebelumnya, model/weights/runtime tidak diganti. Batas PAD0,9/blur80/cosine0,363 tidak diturunkan, setiap frame tetap diperiksa. Perbedaan input ini terbukti oleh test tensor/crop sintetis RED→GREEN, tetapi belum membuktikan bahwa itu satu-satunya penyebab penolakan HP. Tidak melakukan aggregate voting, auto-pass atau bypass anti-spoof.

Verifikasi PASS:197web/39file,20API/5file,12Python (termasuk tensor RGB/normalisasi/resize, crop margin, input blur/SFace tetap, PAD di bawah0,9 tetap ditolak),4E2E UIHP/laptop,lint/typecheck/build/diffcheck,3actualmTLS/transport. Identitas readiness cocok dengan hash source pipeline3, caller lain/input corrupt/model mismatch tetap ditolak. Container nyata dihangatkan ulang lewat launcher lokal yang ancestry/path-nya diperiksa; registry menambahkan versi immutable, migration applied:[], tidak reset DB atau key/akun/counter. Snapshot257MiB/2GiB,2CPU,OOMKilled=false; corrupted transport concurrency1/5/10:26,73/96,84/160,10ms, semua ditolak, bukan latency enrollment/peakRSS. Warning build existing tetap tercatat. Tidak ada perubahan schema/RLS/grant/dependency/absensi/deployment; baseline realDB race dan attendance E2E tidak diulang karena tidak berubah dan data manual dipertahankan.

Acceptance genuine/spoof pada HP, laptop dan ≥100 warm enrollment nyata pipeline3 tetap belum terpenuhi. Bila PAD tetap menolak setelah alignment input, diperlukan evaluasi kamera dan kalibrasi genuine/spoof yang disetujui; jangan menurunkan threshold tanpa bukti atau menandai FV-P3 selesai.

OPEN DECISION production: consent biometrik sekolah/provenance dataset; retensi/hard-delete/backup; hosting/capacity/biaya/private connectivity; threshold/evaluasi lintas pengguna/PAD dan fallback. Key backup/rotation production belum dioperasikan; kehilangan key lokal memerlukan review dan enrollment ulang.

Known limitations: enrollment HP telah dicoba tetapi belum berhasil; threshold engineering dapat false-reject dan perlu evaluasi tanpa bypass keamanan; seluruh frame diperiksa server bisa melampaui target UX; Docker bridge tidak memblokir egress; belum ada klaim siap production. **Phase 3 belum dicentang dan Phase 4 belum dimulai.** Langkah konkret: phase-3-local-runbook.md.
