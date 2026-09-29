# Installer `npm run setup`

## Prinsip

- Fail-fast sebelum mutation database jika runtime, input, key, SSL, atau target project tidak valid.
- Migration dijalankan berurutan dan masing-masing berada dalam transaction.
- Lock advisory mencegah dua installer mengubah schema secara bersamaan.
- Checksum migration yang sudah diterapkan tidak boleh berubah.
- Database connection string tidak pernah ditulis ke disk.
- Password awal hanya dicetak ke terminal setelah validasi akhir.
- `logs/setup.log` berisi status tersanitasi, bukan secret, token, password, atau connection string lengkap.

## Idempotensi

Installer menyimpan metadata di schema private `hadiryu_internal`:

- `schema_migrations` menyimpan nama, SHA-256, waktu apply, dan status adoption;
- `installation_state` menyimpan status setup serta ID akun awal tanpa password.

Pada database kosong, seluruh file `supabase/migrations/*.sql` diterapkan. Pada database HadirYu existing tanpa metadata installer, schema harus lolos validasi lengkap sebelum migration history diadopsi. Schema parsial ditolak agar installer tidak menebak state.

Akun existing dengan role yang benar dipertahankan. Jika proses sebelumnya berhenti saat status `IN_PROGRESS`, password akun setup yang sudah ditandai dapat diputar ulang agar kredensial baru dapat ditampilkan dengan aman.

## Menjalankan ulang

```bash
npm run setup
```

Periksa target, lalu lanjutkan seperti instalasi pertama. Pending migration diterapkan; migration lama hanya diverifikasi. Untuk pemeriksaan read-only schema:

```bash
npm run setup:validate
```

Perintah validasi tetap meminta target dan credential agar tidak memeriksa project yang salah, tetapi tidak menjalankan migration, menulis `.env`, atau mengubah akun.

## Batasan sengaja

- Installer tidak membuat project Supabase atau akun billing.
- Installer tidak menanam jadwal/geofence production karena nilai tersebut adalah keputusan sekolah.
- Installer tidak membuat akun Supabase Auth; login HadirYu memakai `app_accounts`.
- Installer tidak deploy aplikasi. Deployment adalah tahap terpisah.

