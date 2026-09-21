# Keamanan HadirYu

## Model autentikasi

Login aplikasi memakai NIP dan password pada `public.app_accounts`. Password disimpan sebagai hash scrypt berversi; session memakai token opaque yang hanya disimpan dalam bentuk hash pada `app_sessions` dan dikirim lewat cookie HttpOnly. Role berasal dari `profiles`, bukan `user_metadata`.

Supabase Auth bukan sumber akun HadirYu. Tabel `auth.*` tetap menjadi komponen platform Supabase, tetapi installer tidak membuat user di sana.

## Secret

- Jangan commit `.env`, database password, access token, secret/service key, atau session token.
- Publishable key boleh dipakai client hanya bila arsitektur membutuhkannya; HadirYu saat ini mengakses Data API dari backend.
- Secret key hanya boleh tersedia pada Express/Worker.
- Database connection string installer tidak disimpan.
- Gunakan secret manager provider production; jangan menaruh secret di `wrangler.jsonc`.
- Rotasi credential jika pernah masuk log, screenshot, commit, atau tiket support.

## Boundary aplikasi

- Semua input eksternal divalidasi dengan Zod pada API.
- RLS aktif pada tabel exposed; tabel akun/session mencabut akses `anon` dan `authenticated`.
- Waktu resmi dan geofence dihitung backend.
- CORS production memakai allowlist exact origin.
- Cookie production wajib `Secure` dan proxy trust harus sesuai hop nyata.
- Application log tidak boleh memuat password, token, atau koordinat lengkap.

## Pelaporan kerentanan

Sebelum distribusi, ganti bagian ini dengan alamat keamanan pemilik produk. Jangan membuka issue publik yang berisi credential atau data sekolah.

Kontak sementara: `[ISI-EMAIL-KEAMANAN]`

