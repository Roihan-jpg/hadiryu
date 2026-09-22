import { Component } from '@angular/core';

@Component({
  selector: 'app-guide-page',
  template: `
    <section class="page-shell">
      <header><p>PUSAT BANTUAN</p><h1>Panduan Super Admin</h1><span>Prosedur ringkas pengelolaan absensi sekolah dengan HadirYu.</span></header>
      <nav class="toc" aria-label="Daftar isi">@for (section of sections; track section.id) { <a [href]="'#' + section.id">{{ section.title }}</a> }</nav>
      <div class="guide-grid">
        @for (section of sections; track section.id; let index = $index) {
          <article class="admin-panel" [id]="section.id"><span class="number">{{ String(index + 1).padStart(2, '0') }}</span><div><h2>{{ section.title }}</h2><p>{{ section.description }}</p><ul>@for (step of section.steps; track step) { <li>{{ step }}</li> }</ul></div></article>
        }
      </div>
      <aside class="security"><strong>Prinsip keamanan</strong><p>Jangan membagikan akun Super Admin. Password sementara hanya ditampilkan sekali dan berlaku 72 jam. Lampiran bersifat privat dan hanya dapat diunduh oleh pemilik atau Super Admin.</p></aside>
    </section>
  `,
  styles: `
    header { max-width: 720px; margin-bottom: 24px; } header p { margin: 0; color: #477f79; font-size: 10px; font-weight: 800; letter-spacing: .14em; } header h1 { margin: 5px 0; } header span { color: #74817d; font-size: 13px; }
    .toc { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 24px; } .toc a { padding: 7px 10px; color: #477f79; background: #eaf2ef; border-radius: 999px; font-size: 10px; font-weight: 700; text-decoration: none; }
    .guide-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 13px; } article { display: grid; grid-template-columns: 42px 1fr; gap: 12px; padding: 20px; scroll-margin-top: 20px; } .number { display: grid; width: 36px; height: 36px; place-items: center; color: #477f79; background: #eaf2ef; border-radius: 50%; font-size: 10px; font-weight: 800; } h2 { margin: 4px 0 8px; font-size: 16px; } article p, li { color: #687570; font-size: 12px; line-height: 1.65; } article p { margin: 0; } ul { margin: 9px 0 0; padding-left: 18px; }
    .security { margin-top: 18px; padding: 18px 20px; color: #355e59; background: #eaf2ef; border-left: 3px solid #477f79; border-radius: 5px; } .security p { margin: 5px 0 0; font-size: 12px; line-height: 1.6; }
    @media(max-width:760px) { .guide-grid { grid-template-columns: 1fr; } }
  `,
})
export class GuidePage {
  protected readonly String = String;
  protected readonly sections = [
    { id: 'monitoring', title: 'Monitoring harian', description: 'Pantau status kehadiran dari tanggal server.', steps: ['Pilih tanggal dan status untuk mempersempit tabel.', 'Klik baris untuk membaca detail dan menambah catatan admin.', 'Catatan bersifat append-only dan tidak mengubah timestamp absensi.'] },
    { id: 'guru', title: 'Akun Guru', description: 'Kelola identitas dan akses Guru.', steps: ['Gunakan NIP unik dan nomor WhatsApp berformat +62.', 'Aktifkan atau nonaktifkan akun tanpa menghapus riwayat.', 'Salin password sementara saat dialog hasil tampil.'] },
    { id: 'approval', title: 'Approval', description: 'Izin dan pulang awal memiliki antrean terpisah.', steps: ['Buka detail untuk melihat alasan dan lampiran.', 'Tuliskan catatan bila diperlukan lalu putuskan dari halaman detail.', 'Pulang awal yang disetujui mendapat kredit target penuh.'] },
    { id: 'geofence', title: 'Geofence', description: 'Lokasi selalu divalidasi oleh backend.', steps: ['Tinjau poligon dan akurasi pada tab Geofence.', 'Versi hari ini boleh diperbarui; histori lampau tidak dapat diubah.', 'Lakukan survei lapangan sebelum konfigurasi produksi.'] },
    { id: 'calendar', title: 'Jadwal & kalender', description: 'Jadwal dan pengecualian memakai tanggal server Jakarta.', steps: ['Gunakan tab Jadwal untuk jam kerja hari biasa dan Sabtu.', 'Gunakan Kalender untuk libur atau hari kerja khusus.', 'Jangan mengubah konfigurasi historis.'] },
    { id: 'reports', title: 'Laporan', description: 'Laporan memakai kalkulasi backend, bukan formula lama.', steps: ['Pilih bulan lalu tampilkan pratinjau.', 'Selesaikan approval Pending yang menjadi blocker.', 'Ekspor Excel; nominal upah tetap kosong untuk staf kantor.'] },
  ];
}
