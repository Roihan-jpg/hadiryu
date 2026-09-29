import type { AuditLog } from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AuditService } from './audit.service';

@Component({
  selector: 'app-audit-page',
  imports: [MatButtonModule, MatPaginatorModule, MatProgressSpinnerModule, ReactiveFormsModule],
  template: `
    <section class="page-shell">
      <header><p>AUDIT & KEAMANAN</p><h1>Audit Log</h1><span>Riwayat aktivitas penting tersimpan append-only.</span></header>
      <form class="admin-panel filters" (ngSubmit)="applyFilters()">
        <label>Dari tanggal<input type="date" [formControl]="fromDate" /></label><label>Sampai tanggal<input type="date" [formControl]="toDate" /></label>
        <label>ID aktor<input type="text" [formControl]="actorId" placeholder="UUID Super Admin/Guru" /></label><label>Tindakan<input type="text" [formControl]="action" placeholder="Contoh: LEAVE_APPROVED" /></label><label>Tipe entitas<input type="text" [formControl]="entityType" placeholder="leave_requests" /></label>
        <button mat-flat-button type="submit">Terapkan</button>
      </form>
      @if (errorMessage()) { <p class="feedback error" role="alert">{{ errorMessage() }}</p> }
      @if (loading()) { <div class="loading"><mat-spinner diameter="28" /> Memuat audit…</div> }
      @else {
        <div class="admin-panel table-wrap">
          <table><thead><tr><th>Waktu</th><th>Aktor</th><th>Tindakan</th><th>Entitas</th><th>Perubahan</th></tr></thead><tbody>
            @for (item of records(); track item.id) { <tr><td>{{ dateTime(item.createdAt) }}</td><td><strong>{{ item.actorFullName }}</strong><small>{{ item.actorNip }}</small></td><td><code>{{ item.action }}</code></td><td>{{ item.entityType }}</td><td><details><summary>Lihat data</summary><pre>{{ dataLabel(item) }}</pre></details></td></tr> }
          </tbody></table>
          @if (records().length === 0) { <p class="empty">Tidak ada aktivitas pada filter ini.</p> }
        </div>
        <mat-paginator [length]="pagination().totalItems" [pageIndex]="pagination().page - 1" [pageSize]="pagination().pageSize" [pageSizeOptions]="[10,25,50]" (page)="pageChanged($event)" />
      }
    </section>
  `,
  styles: `
    header { margin-bottom: 24px; } header p { margin: 0; color: #477f79; font-size: 10px; font-weight: 800; letter-spacing: .14em; } header h1 { margin: 5px 0; } header span { color: #74817d; font-size: 13px; }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(125px, 1fr)) auto; align-items: end; gap: 10px; padding: 15px; margin-bottom: 16px; } label { display: grid; gap: 5px; color: #74817d; font-size: 10px; font-weight: 700; } input { min-width: 0; height: 39px; padding: 0 10px; background: #fffdf9; border: 1px solid #d9d0c5; border-radius: 5px; color: #34413e; font: inherit; }
    .table-wrap { overflow-x: auto; } table { width: 100%; min-width: 850px; border-collapse: collapse; } th, td { padding: 11px 14px; border-bottom: 1px solid #e8e0d6; vertical-align: top; text-align: left; font-size: 11px; } th { color: #74817d; background: #f7f2eb; font-size: 9px; letter-spacing: .07em; text-transform: uppercase; } td small { display: block; color: #74817d; } code { color: #35665f; font-size: 10px; } summary { color: #477f79; cursor: pointer; } pre { max-width: 390px; max-height: 220px; overflow: auto; white-space: pre-wrap; font-size: 10px; } .empty, .loading { display: flex; justify-content: center; gap: 10px; padding: 40px; color: #74817d; }
    @media(max-width:900px) { .filters { grid-template-columns: repeat(2, 1fr); } } @media(max-width:520px) { .filters { grid-template-columns: 1fr; } }
  `,
})
export class AuditPage implements OnInit {
  private readonly service = inject(AuditService);
  readonly fromDate = new FormControl('', { nonNullable: true }); readonly toDate = new FormControl('', { nonNullable: true }); readonly actorId = new FormControl('', { nonNullable: true }); readonly action = new FormControl('', { nonNullable: true }); readonly entityType = new FormControl('', { nonNullable: true });
  readonly records = signal<AuditLog[]>([]); readonly loading = signal(true); readonly errorMessage = signal(''); readonly pagination = signal({ page: 1, pageSize: 25, totalItems: 0, totalPages: 0 });
  ngOnInit(): void { void this.load(); }
  async load(): Promise<void> { this.loading.set(true); this.errorMessage.set(''); const page = this.pagination(); try { const result = await this.service.list({ page: page.page, pageSize: page.pageSize, ...(this.fromDate.value ? { fromDate: this.fromDate.value } : {}), ...(this.toDate.value ? { toDate: this.toDate.value } : {}), ...(this.actorId.value.trim() ? { actorId: this.actorId.value.trim() } : {}), ...(this.action.value.trim() ? { action: this.action.value.trim() } : {}), ...(this.entityType.value.trim() ? { entityType: this.entityType.value.trim() } : {}) }); this.records.set(result.data); this.pagination.set(result.pagination); } catch (error) { this.errorMessage.set(await this.errorText(error)); } finally { this.loading.set(false); } }
  async applyFilters(): Promise<void> { this.pagination.update((value) => ({ ...value, page: 1 })); await this.load(); }
  async pageChanged(event: PageEvent): Promise<void> { this.pagination.update((value) => ({ ...value, page: event.pageIndex + 1, pageSize: event.pageSize })); await this.load(); }
  dateTime(value: string): string { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)); }
  dataLabel(item: AuditLog): string { return JSON.stringify({ sebelum: item.beforeData, sesudah: item.afterData }, null, 2); }
  private async errorText(error: unknown): Promise<string> { if (error instanceof HttpErrorResponse) { const { ApiErrorSchema } = await import('@absensi/contracts'); const parsed = ApiErrorSchema.safeParse(error.error); if (parsed.success) return parsed.data.error.message; } return 'Audit log tidak dapat dimuat.'; }
}
