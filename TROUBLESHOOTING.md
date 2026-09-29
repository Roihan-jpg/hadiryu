# Troubleshooting HadirYu

## Node.js atau npm tidak didukung

Gunakan salah satu versi pada `package.json`: Node.js `22.22.3+`, `24.15.0+`, atau `26+`, dengan npm `11+`. Hindari Node.js major ganjil yang tidak tercantum.

## Publishable/secret key ditolak

Pastikan key berasal dari project yang URL-nya dimasukkan. Jangan tertukar antara publishable dan secret key. Key legacy anon/service-role masih dapat dipakai selama didukung Supabase, tetapi key baru lebih dianjurkan.

## Database menolak koneksi

- URL hosted wajib memiliki `sslmode=require`.
- Gunakan direct connection atau session pooler port `5432`.
- Port `6543` adalah transaction pooler dan sengaja ditolak untuk migration.
- Encode karakter khusus pada password URL.
- Jika direct host hanya IPv6, gunakan session pooler.

## URL API dan database dianggap berbeda

Untuk direct connection, host harus `db.<project-ref>.supabase.co`. Untuk session pooler, username biasanya berakhiran `.<project-ref>`. Salin kedua nilai dari project dashboard yang sama.

## Checksum migration berubah

File migration yang sudah diterapkan telah diedit. Pulihkan isi aslinya dari release yang dipakai database, lalu buat migration baru untuk perubahan berikutnya. Jangan mengubah checksum di database secara manual.

## Schema existing tidak dapat diadopsi

Installer hanya mengadopsi schema HadirYu yang lolos validasi tabel, kolom akhir, RLS, dan boundary hak akses. Backup database, identifikasi migration yang hilang, dan perbaiki dengan prosedur upgrade yang terkontrol. Jangan menjalankan SQL acak atau menonaktifkan RLS.

## Password awal tidak terlihat

Password hanya dicetak ketika akun dibuat atau diputar ulang dari setup `IN_PROGRESS`. Pada setup yang sudah `COMPLETE`, password existing tidak diubah. Gunakan fitur reset password SuperAdmin atau prosedur recovery yang diaudit.

## Docker/Supabase lokal tidak aktif

Mulai Docker Desktop lalu jalankan `npm run db:start`. Error pipe Docker pada Windows berarti engine Docker belum berjalan.

## Log setup

Lihat `logs/setup.log`. File ini gitignored dan disanitasi. Jangan mengirim `.env`, database URL lengkap, token, atau screenshot password ke support.

