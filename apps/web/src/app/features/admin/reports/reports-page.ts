import type { MonthlyReportPreview } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import { ReportsService } from './reports.service';

@Component({
  selector: 'app-reports-page',
  imports: [MatButtonModule, MatProgressSpinnerModule, MatSelectModule, ReactiveFormsModule],
  template: `
    <section class="page-shell">
      <header><p class="eyebrow">DOKUMEN BULANAN</p><h1>Laporan Absensi</h1><p>Pratinjau data sebelum mengekspor lembar kerja resmi.</p></header>
      <div class="admin-panel filters">
        <label>Bulan<select [formControl]="monthControl">@for (month of months; track month.value) { <option [value]="month.value">{{ month.label }}</option> }</select></label>
        <label>Tahun<select [formControl]="yearControl">@for (year of years; track year) { <option [value]="year">{{ year }}</option> }</select></label>
        <button mat-flat-button type="button" (click)="load()" [disabled]="loading()">Tampilkan</button>
        <button mat-stroked-button type="button" (click)="exportReport()" [disabled]="loading() || exporting() || !report()">{{ exporting() ? 'Menyiapkan…' : 'Ekspor Excel' }}</button>
      </div>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (loading()) { <div class="loading"><mat-spinner diameter="28" /><span>Menyiapkan laporan…</span></div> }
      @else if (report(); as value) {
        <div class="summary-grid">
          <article class="admin-panel"><span>Guru tercakup</span><strong>{{ value.teachers.length }}</strong></article>
          <article class="admin-panel"><span>Total hari terlambat</span><strong>{{ lateDays() }}</strong></article>
          <article class="admin-panel"><span>Total hari tidak hadir</span><strong>{{ absentDays() }}</strong></article>
          <article class="admin-panel"><span>Total kekurangan</span><strong>{{ deficitHours() }}</strong><small>jam</small></article>
        </div>
        <div class="admin-panel table-wrap">
          <table><thead><tr><th>Guru</th><th>NIP</th><th>Hari terlambat</th><th>Tidak hadir</th><th>Kekurangan</th></tr></thead>
          <tbody>@for (teacher of value.teachers; track teacher.teacherId) { <tr><td><strong>{{ teacher.teacherFullName }}</strong></td><td>{{ teacher.teacherNip }}</td><td>{{ teacher.lateDayCount }}</td><td>{{ teacher.absentDayCount }}</td><td>{{ minutesLabel(teacher.totalWorkDeficitMinutes) }}</td></tr> }</tbody></table>
          @if (value.teachers.length === 0) { <p class="empty">Belum ada Guru aktif untuk periode ini.</p> }
        </div>
      }
    </section>
  `,
  styles: `
    header { margin-bottom: 24px; } header p { margin: 0; color: #74817d; } .eyebrow { color: #477f79 !important; font-size: 10px; font-weight: 800; letter-spacing: .14em; } h1 { margin: 5px 0 7px; }
    .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; padding: 16px; } label { display: grid; gap: 5px; color: #74817d; font-size: 11px; font-weight: 700; } select { min-width: 150px; height: 40px; padding: 0 10px; color: #34413e; background: #fffdf9; border: 1px solid #d9d0c5; border-radius: 5px; font: inherit; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; } .summary-grid article { padding: 17px; } .summary-grid span { display: block; color: #74817d; font-size: 11px; } .summary-grid strong { margin-right: 5px; font-size: 27px; font-variant-numeric: tabular-nums; } .summary-grid small { color: #74817d; }
    .table-wrap { overflow-x: auto; } table { width: 100%; min-width: 650px; border-collapse: collapse; } th, td { padding: 12px 16px; border-bottom: 1px solid #e8e0d6; text-align: left; font-size: 12px; } th { color: #74817d; background: #f7f2eb; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; } .empty, .loading { display: flex; justify-content: center; gap: 10px; padding: 40px; color: #74817d; }
    @media(max-width:850px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } } @media(max-width:480px) { .summary-grid { grid-template-columns: 1fr; } .filters button { width: 100%; } }
  `,
})
export class ReportsPage implements OnInit {
  private readonly service = inject(ReportsService);
  readonly loading = signal(true); readonly exporting = signal(false); readonly errorMessage = signal(''); readonly report = signal<MonthlyReportPreview | null>(null);
  readonly monthControl = new FormControl(1, { nonNullable: true }); readonly yearControl = new FormControl(new Date().getFullYear(), { nonNullable: true });
  readonly months = Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2026, index, 1)) }));
  readonly years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - 3 + index);
  readonly lateDays = computed(() => this.report()?.teachers.reduce((sum, item) => sum + item.lateDayCount, 0) ?? 0);
  readonly absentDays = computed(() => this.report()?.teachers.reduce((sum, item) => sum + item.absentDayCount, 0) ?? 0);
  readonly deficitHours = computed(() => ((this.report()?.teachers.reduce((sum, item) => sum + item.totalWorkDeficitMinutes, 0) ?? 0) / 60).toFixed(1));
  async ngOnInit(): Promise<void> { try { const period = await this.service.defaultPeriod(); this.monthControl.setValue(period.month); this.yearControl.setValue(period.year); } catch { /* load provides the visible error */ } await this.load(); }
  async load(): Promise<void> { this.loading.set(true); this.errorMessage.set(''); try { this.report.set(await this.service.preview(this.yearControl.value, this.monthControl.value)); } catch (error) { this.report.set(null); this.errorMessage.set(await this.errorText(error, 'Laporan tidak dapat dimuat. Pastikan seluruh approval periode ini sudah diputuskan.')); } finally { this.loading.set(false); } }
  async exportReport(): Promise<void> { this.exporting.set(true); this.errorMessage.set(''); try { await this.service.export(this.yearControl.value, this.monthControl.value); } catch (error) { this.errorMessage.set(await this.errorText(error, 'Laporan tidak dapat diekspor.')); } finally { this.exporting.set(false); } }
  minutesLabel(value: number): string { return `${Math.floor(value / 60)}j ${value % 60}m`; }
  private async errorText(error: unknown, fallback: string): Promise<string> { if (error instanceof HttpErrorResponse) { const { ApiErrorSchema } = await import('@absensi/contracts'); const parsed = ApiErrorSchema.safeParse(error.error); if (parsed.success) return parsed.data.error.message; } return fallback; }
}
