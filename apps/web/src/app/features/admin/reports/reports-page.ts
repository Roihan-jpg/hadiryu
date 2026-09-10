import type {
  MonthlyReportPreview,
  MonthlyReportIssue,
  MonthlyReportReadiness,
  MonthlyReportReadinessIssue,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';

import { ReportsService } from './reports.service';

type StaffReportIssue = Extract<MonthlyReportIssue, { category: 'STAFF_DATA' }>;
type StaffReportIssueGroup = Omit<StaffReportIssue, 'workDate'> & {
  workDates: string[];
};

@Component({
  selector: 'app-reports-page',
  imports: [MatButtonModule, MatProgressSpinnerModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="page-shell">
      <header><p class="eyebrow">DOKUMEN BULANAN</p><h1>Laporan Absensi</h1><p>Pratinjau data sebelum mengekspor lembar kerja resmi.</p></header>
      <div class="admin-panel filters">
        <label>Bulan<select [formControl]="monthControl">@for (month of months; track month.value) { <option [value]="month.value">{{ month.label }}</option> }</select></label>
        <label>Tahun<select [formControl]="yearControl">@for (year of years; track year) { <option [value]="year">{{ year }}</option> }</select></label>
        <button mat-flat-button type="button" (click)="load()" [disabled]="loading()">Tampilkan</button>
        <button mat-stroked-button type="button" (click)="exportReport()" [disabled]="loading() || exporting() || !report()">{{ exporting() ? 'Menyiapkan…' : report()?.documentStatus === 'DRAFT' ? 'Ekspor draft' : 'Ekspor final' }}</button>
      </div>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (loading()) { <div class="loading"><mat-spinner diameter="28" /><span>Menyiapkan laporan…</span></div> }
      @else if (report(); as value) {
        @if (value.documentStatus === 'DRAFT') {
        <section class="admin-panel readiness-panel" aria-labelledby="readiness-title">
          <p class="eyebrow">PEMERIKSAAN KESIAPAN</p>
          <h2 id="readiness-title">Laporan dapat diekspor dengan catatan</h2>
          <p>File akan diberi label DRAFT. Data yang tidak tersedia tetap kosong atau mengikuti hasil sistem saat ini; periksa daftar ini dan konfirmasi langsung kepada staf. Perubahan manual di Excel tidak tersimpan ke sistem dan total tidak dihitung ulang otomatis.</p>
          @if (periodIssues().length) {
            <p class="period-note"><strong>Periode masih berjalan.</strong> Tanggal mendatang tidak dihitung sebagai absen; ekspor ulang setelah akhir bulan untuk mendapatkan status final.</p>
          }
          @if (configurationIssues().length) {
            <h3>Perlu tindakan admin</h3>
            <ul>
              @for (issue of configurationIssues(); track issue.code) {
                <li><span><strong>{{ issueLabel(issue) }}</strong><small>Atur konfigurasi lalu ekspor ulang.</small></span><span>{{ rangeLabel(issue) }}</span><a mat-stroked-button routerLink="/admin/settings" [queryParams]="{ tab: issue.source === 'SECURITY_SCHEDULE' ? 'security' : 'schedule' }">Buka jadwal</a></li>
              }
            </ul>
          }
          @if (staffIssueGroups().length) {
            <h3>Perlu konfirmasi pengguna</h3>
            <ul>
              @for (issue of staffIssueGroups(); track issue.teacherId + issue.code) {
                <li><span><strong>{{ issue.teacherFullName }}</strong><small>{{ issue.teacherRole === 'SECURITY_GUARD' ? 'Satpam' : 'Guru' }} · {{ issue.teacherNip }} · {{ staffIssueLabel(issue) }}</small></span><span>{{ dateRangesLabel(issue.workDates) }}</span><span class="issue-actions">@if (issue.teacherWhatsapp) { <a mat-stroked-button [href]="whatsappUrl(issue.teacherWhatsapp)" target="_blank" rel="noopener noreferrer">Hubungi WhatsApp</a> }<a mat-button routerLink="/admin" [queryParams]="{ workDate: issue.workDates[0] }">Lihat absensi</a></span></li>
              }
            </ul>
          }
        </section>
        }
        <div class="summary-grid">
          <article class="admin-panel"><span>Staf tercakup</span><strong>{{ value.teachers.length }}</strong></article>
          <article class="admin-panel"><span>Total hari terlambat</span><strong>{{ lateDays() }}</strong></article>
          <article class="admin-panel"><span>Total hari tidak hadir</span><strong>{{ absentDays() }}</strong></article>
          <article class="admin-panel"><span>Total kekurangan</span><strong>{{ deficitHours() }}</strong><small>jam</small></article>
        </div>
        <div class="admin-panel table-wrap">
          <table><thead><tr><th>Guru / Satpam</th><th>NIP</th><th>Hari terlambat</th><th>Tidak hadir</th><th>Kekurangan</th></tr></thead>
          <tbody>@for (teacher of value.teachers; track teacher.teacherId) { <tr><td><strong>{{ teacher.teacherFullName }}</strong><small>{{ teacher.role === 'SECURITY_GUARD' ? 'Satpam' : 'Guru' }}</small></td><td>{{ teacher.teacherNip }}</td><td>{{ teacher.lateDayCount }}</td><td>{{ teacher.absentDayCount }}</td><td>{{ minutesLabel(teacher.totalWorkDeficitMinutes) }}</td></tr> }</tbody></table>
          @if (value.teachers.length === 0) { <p class="empty">Belum ada Guru atau Satpam aktif untuk periode ini.</p> }
        </div>
      }
    </section>
  `,
  styles: `
    header { margin-bottom: 24px; } header p { margin: 0; color: #74817d; } .eyebrow { color: #477f79 !important; font-size: 10px; font-weight: 800; letter-spacing: .14em; } h1 { margin: 5px 0 7px; }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 16px; } label { display: grid; gap: 5px; color: #74817d; font-size: 11px; font-weight: 700; } select { min-width: 150px; height: 40px; padding: 0 10px; color: #34413e; background: #fffdf9; border: 1px solid #d9d0c5; border-radius: 5px; font: inherit; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; } .summary-grid article { padding: 17px; } .summary-grid span { display: block; color: #74817d; font-size: 11px; } .summary-grid strong { margin-right: 5px; font-size: 27px; font-variant-numeric: tabular-nums; } .summary-grid small { color: #74817d; }
    .table-wrap { overflow-x: auto; } table { width: 100%; min-width: 650px; border-collapse: collapse; } th, td { padding: 12px 16px; border-bottom: 1px solid #e8e0d6; text-align: left; font-size: 12px; } th { color: #74817d; background: #f7f2eb; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; } .empty, .loading { display: flex; justify-content: center; gap: 10px; padding: 40px; color: #74817d; }
    .readiness-panel { margin-top: 20px; padding: 20px; border-left: 4px solid #a36622; } .readiness-panel h2 { margin: 5px 0 8px; } .readiness-panel h3 { margin: 22px 0 6px; font-size: 13px; } .readiness-panel > p:not(.eyebrow) { max-width: 780px; margin: 0; color: #74817d; } .readiness-panel .period-note { margin-top: 12px !important; padding: 10px 12px; background: #fff7e8; border: 1px solid #ead4ad; border-radius: 5px; } .readiness-panel ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; } .readiness-panel li { display: grid; grid-template-columns: minmax(210px, 1fr) auto auto; align-items: center; gap: 8px 20px; padding-top: 10px; border-top: 1px solid #e8e0d6; } .readiness-panel li span { color: #74817d; font-variant-numeric: tabular-nums; } .readiness-panel li span:first-child { display: grid; gap: 2px; color: #34413e; } .readiness-panel li small { color: #74817d; font-weight: 500; } .issue-actions { display: flex !important; grid-auto-flow: column; align-items: center; gap: 4px !important; }
    @media(max-width:850px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } .readiness-panel li { grid-template-columns: 1fr; } .issue-actions { justify-content: flex-start; } } @media(max-width:480px) { .summary-grid { grid-template-columns: 1fr; } .filters button { width: 100%; } }
  `,
})
export class ReportsPage implements OnInit {
  private readonly service = inject(ReportsService);
  readonly loading = signal(true); readonly exporting = signal(false); readonly errorMessage = signal(''); readonly report = signal<MonthlyReportPreview | null>(null); readonly readiness = signal<MonthlyReportReadiness | null>(null);
  readonly monthControl = new FormControl(1, { nonNullable: true }); readonly yearControl = new FormControl(new Date().getFullYear(), { nonNullable: true });
  readonly months = Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2026, index, 1)) }));
  readonly years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 3 + index);
  readonly lateDays = computed(() => this.report()?.teachers.reduce((sum, item) => sum + item.lateDayCount, 0) ?? 0);
  readonly absentDays = computed(() => this.report()?.teachers.reduce((sum, item) => sum + item.absentDayCount, 0) ?? 0);
  readonly deficitHours = computed(() => ((this.report()?.teachers.reduce((sum, item) => sum + item.totalWorkDeficitMinutes, 0) ?? 0) / 60).toFixed(1));
  readonly configurationIssues = computed(() =>
    (this.report()?.issues ?? []).filter(
      (issue): issue is Extract<MonthlyReportIssue, { category: 'CONFIGURATION' }> =>
        issue.category === 'CONFIGURATION',
    ),
  );
  readonly staffIssueGroups = computed<StaffReportIssueGroup[]>(() => {
    const groups = new Map<string, StaffReportIssueGroup>();
    for (const issue of this.report()?.issues ?? []) {
      if (issue.category !== 'STAFF_DATA') continue;
      const key = `${issue.teacherId}:${issue.code}`;
      const current = groups.get(key);
      if (current) current.workDates.push(issue.workDate);
      else {
        const { workDate, ...details } = issue;
        groups.set(key, { ...details, workDates: [workDate] });
      }
    }
    return [...groups.values()];
  });
  readonly periodIssues = computed(() =>
    (this.report()?.issues ?? []).filter((issue) => issue.category === 'PERIOD'),
  );
  async ngOnInit(): Promise<void> { try { const period = await this.service.defaultPeriod(); this.monthControl.setValue(period.month); this.yearControl.setValue(period.year); } catch { /* load provides the visible error */ } await this.load(); }
  async load(): Promise<void> { this.loading.set(true); this.errorMessage.set(''); this.report.set(null); this.readiness.set(null); try { const readiness = await this.service.readiness(this.yearControl.value, this.monthControl.value); this.readiness.set(readiness); this.report.set(await this.service.preview(this.yearControl.value, this.monthControl.value)); } catch (error) { this.errorMessage.set(await this.errorText(error, 'Laporan tidak dapat dimuat.')); } finally { this.loading.set(false); } }
  async exportReport(): Promise<void> { if (!this.report()) return; this.exporting.set(true); this.errorMessage.set(''); try { await this.service.export(this.yearControl.value, this.monthControl.value); } catch (error) { this.errorMessage.set(await this.errorText(error, 'Laporan tidak dapat diekspor.')); } finally { this.exporting.set(false); } }
  minutesLabel(value: number): string { return `${Math.floor(value / 60)}j ${value % 60}m`; }
  issueLabel(issue: MonthlyReportReadinessIssue): string { return issue.source === 'SECURITY_SCHEDULE' ? 'Jadwal Satpam' : 'Jadwal Guru'; }
  rangeLabel(issue: MonthlyReportReadinessIssue): string { return issue.missingRanges.map((range) => `${this.dateLabel(range.startDate)}–${this.dateLabel(range.endDate)}`).join(', '); }
  staffIssueLabel(issue: Pick<StaffReportIssue, 'code'>): string { return ({ NO_ATTENDANCE: 'Absensi belum ditemukan', INCOMPLETE_ATTENDANCE: 'Checkout belum tersedia', PENDING_LEAVE: 'Izin masih pending', PENDING_EARLY_DEPARTURE: 'Pulang awal masih pending' } as const)[issue.code]; }
  dateRangesLabel(values: readonly string[]): string { const ranges: Array<{ start: string; end: string }> = []; for (const value of values) { const current = ranges.at(-1); if (current && this.nextDate(current.end) === value) current.end = value; else ranges.push({ start: value, end: value }); } return ranges.map((range) => range.start === range.end ? this.dateLabel(range.start) : `${this.dateLabel(range.start)}–${this.dateLabel(range.end)}`).join(', '); }
  whatsappUrl(value: string): string { return `https://wa.me/${value.replace(/\D/g, '')}`; }
  dateLabel(value: string): string { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`)); }
  private nextDate(value: string): string { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
  private async errorText(error: unknown, fallback: string): Promise<string> { if (error instanceof HttpErrorResponse) { const { ApiErrorSchema } = await import('@absensi/contracts'); const parsed = ApiErrorSchema.safeParse(error.error); if (parsed.success) return parsed.data.error.message; } return fallback; }
}
