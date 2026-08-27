# T15 Checklist

- [x] Playwright dan Chromium smoke project terpasang serta dikonfigurasi.
- [x] Guardrail script hosted menolak project ref/URL yang tidak sesuai dan tidak memuat reset/seed remote.
- [x] `.env.production.example` hanya berisi placeholder/non-secret.
- [x] Bootstrap SuperAdmin membaca NIP, nama, dan password hanya dari environment.
- [x] Local E2E mencakup setup, Guru login/ganti password, check-in/checkout, izin, approval, preview, dan ekspor.
- [x] Hosted smoke memakai credential khusus dari environment dan tidak membuat/menimpa akun secara otomatis.
- [x] Dokumentasi environment/deployment menyertakan dry-run, advisors, dan larangan reset/seed hosted.
- [x] Seluruh verification gate lokal lulus.
- [ ] Link, deploy migration, advisors, dan smoke hosted lulus pada project `agtmvpjtqcmsqvatskjg`.
- [ ] Review akhir selesai; T15 dan `MEMORY.md` diperbarui hanya jika seluruh gate lulus.
