# Instalasi HadirYu

## 1. Siapkan perangkat

Pasang Git, Node.js yang didukung, dan npm 11+. Docker Desktop hanya diperlukan untuk development dengan Supabase lokal, bukan untuk instalasi ke project Supabase hosted.

Pastikan versi:

```bash
node --version
npm --version
```

## 2. Buat project Supabase baru

Di dashboard Supabase, buat project kosong khusus instalasi ini. Catat:

- Project URL, misalnya `https://<project-ref>.supabase.co`;
- publishable key (`sb_publishable_...` atau anon key legacy);
- secret key (`sb_secret_...` atau service-role key legacy);
- database connection string direct atau session pooler port `5432`.

Connection string hosted wajib memiliki `sslmode=require`. Jangan memakai transaction pooler port `6543` untuk migration. Jika direct connection tidak dapat diakses melalui IPv4, gunakan session pooler port `5432`.

## 3. Instal dependency

```bash
git clone <URL-SOURCE-HADIRYU>
cd <FOLDER-HADIRYU>
npm ci
```

Jangan menyalin `.env` dari instalasi penjual atau instalasi lain.

## 4. Jalankan installer

```bash
npm run setup
```

Masukkan Project URL, publishable key, secret key, database connection string, serta identitas akun awal. Nilai sensitif disembunyikan di terminal. Periksa ringkasan host database sebelum mengetik `LANJUT`.

Installer akan:

1. memeriksa versi runtime dan struktur source;
2. menguji kedua API key terhadap Supabase;
3. memastikan URL API dan database menunjuk project yang sama;
4. menjalankan migration dan memvalidasi RLS;
5. menulis hanya konfigurasi runtime ke `.env`;
6. membuat SuperAdmin dan Guru demo di `profiles` + `app_accounts`;
7. menampilkan password awal satu kali.

Simpan password awal di password manager. Password tidak masuk ke `.env` atau `logs/setup.log`.

## 5. Jalankan aplikasi

Untuk development lokal:

```bash
npm run dev
```

Buka `http://127.0.0.1:4200`, login sebagai SuperAdmin, lalu:

1. buka **Jadwal & Lokasi**;
2. isi jadwal kerja sesuai kebijakan sekolah;
3. gambar polygon geofence sekolah dan atur akurasi;
4. ganti/nonaktifkan akun Guru demo bila tidak diperlukan;
5. buat akun Guru dan Satpam sebenarnya dari UI.

Untuk production, lanjutkan ke [DEPLOYMENT.md](DEPLOYMENT.md).

## Instalasi non-interaktif

Mode ini ditujukan untuk CI pada database disposable. Secret tetap diberikan melalui environment, bukan argumen command:

```bash
npm run setup -- --non-interactive
```

Variable yang tersedia: `HADIRYU_DATABASE_URL`, `HADIRYU_ADMIN_NIP`, `HADIRYU_ADMIN_FULL_NAME`, `HADIRYU_DEMO_TEACHER_NIP`, `HADIRYU_DEMO_TEACHER_NAME`, dan `HADIRYU_DEMO_TEACHER_GENDER`. Konfigurasi Supabase dibaca dari `.env` atau environment runtime.

