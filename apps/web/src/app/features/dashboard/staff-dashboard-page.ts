import type {
  DashboardActivity,
  DashboardActivityFilter,
  EarlyDepartureDashboardActivity,
  PunctualityTrendItem,
} from '@absensi/contracts';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { createIndonesianPaginatorIntl } from '../../core/ui/paginator-intl';
import { StaffDashboardService } from './staff-dashboard.service';

function currentJakartaMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
}

@Component({
  imports: [MatButtonModule, MatPaginatorModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  selector: 'app-staff-dashboard-page',
  providers: [{ provide: MatPaginatorIntl, useFactory: createIndonesianPaginatorIntl }],
  styleUrl: './staff-dashboard-page.scss',
  templateUrl: './staff-dashboard-page.html',
})
export class StaffDashboardPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly service = inject(StaffDashboardService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly user = this.auth.user;
  readonly monthControl = new FormControl(currentJakartaMonth(), { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{4}-(?:0[1-9]|1[0-2])$/)] });
  readonly typeControl = new FormControl<DashboardActivityFilter>('ALL', { nonNullable: true });
  readonly filters = signal({ month: this.monthControl.value, page: 1, pageSize: 8, type: this.typeControl.value });
  readonly dashboardQuery = injectQuery(() => ({
    queryKey: queryKeys.staffDashboard(this.filters()),
    queryFn: () => this.service.fetch(this.filters()),
  }));
  readonly dashboard = computed(() => this.dashboardQuery.data());
  readonly activities = computed(() => this.dashboard()?.activity.data ?? []);
  readonly expandedActivityId = signal<string | null>(null);
  readonly preview = signal<{ id: string; url: string; safeUrl: SafeResourceUrl; mimeType: string; name: string } | null>(null);
  readonly previewLoadingId = signal<string | null>(null);
  readonly previewErrorId = signal<string | null>(null);
  readonly chartBars = computed(() => {
    const values = this.dashboard()?.punctualityTrend ?? [];
    const maximum = Math.max(1, ...values.map((item) => Math.abs(item.arrivalOffsetMinutes)));
    return values.map((item) => ({ item, size: Math.max(4, Math.round(Math.abs(item.arrivalOffsetMinutes) / maximum * 92)) }));
  });

  applyFilters(): void {
    if (this.monthControl.invalid) { this.monthControl.markAsTouched(); return; }
    this.filters.set({ month: this.monthControl.value, page: 1, pageSize: this.filters().pageSize, type: this.typeControl.value });
    this.closePreview();
  }

  pageChanged(event: PageEvent): void {
    this.filters.update((value) => ({ ...value, page: event.pageIndex + 1, pageSize: event.pageSize }));
    this.closePreview();
  }

  toggleActivity(activity: DashboardActivity): void {
    this.expandedActivityId.update((id) => id === activity.id ? null : activity.id);
    if (this.preview()?.id !== activity.id) this.closePreview();
  }

  async showAttachment(activity: Extract<DashboardActivity, { type: 'LEAVE' | 'EARLY_DEPARTURE' }> | EarlyDepartureDashboardActivity): Promise<void> {
    if (!activity.attachment || this.previewLoadingId()) return;
    this.closePreview();
    this.previewLoadingId.set(activity.id);
    this.previewErrorId.set(null);
    try {
      const blob = await this.service.fetchAttachment(activity.type, activity.id);
      const url = URL.createObjectURL(blob);
      this.preview.set({ id: activity.id, url, safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(url), mimeType: activity.attachment.mimeType, name: activity.attachment.originalName });
    } catch { this.previewErrorId.set(activity.id); }
    finally { this.previewLoadingId.set(null); }
  }

  ngOnDestroy(): void { this.closePreview(); }

  protected closePreview(): void {
    const active = this.preview();
    if (active) URL.revokeObjectURL(active.url);
    this.preview.set(null);
  }

  absenPath(): string { return this.user()?.role === 'SECURITY_GUARD' ? '/satpam/absen' : '/guru/absen'; }
  statusHeadline(): string {
    const state = this.dashboard()?.todayAttendance.state;
    if (state === 'CHECKED_IN') return 'Absen Masuk sudah tercatat';
    if (state === 'COMPLETED') return 'Absensi hari ini lengkap';
    if (state === 'INCOMPLETE') return 'Absen Pulang belum tercatat';
    if (state === 'NON_WORKING_DAY') return 'Tidak ada jadwal hari ini';
    if (state === 'CONFIGURATION_ERROR') return 'Jadwal belum dapat dibaca';
    return 'Siap mencatat Absen Masuk';
  }
  statusValue(): string {
    const attendance = this.dashboard()?.todayAttendance.attendance;
    return attendance ? this.jakartaTime(attendance.checkInAt) : '—';
  }
  statusCta(): string { return this.dashboard()?.todayAttendance.state === 'CHECKED_IN' ? 'Catat Absen Pulang' : 'Buka halaman Absen'; }
  jakartaTime(timestamp: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)); }
  dateLabel(workDate: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${workDate}T00:00:00.000Z`)); }
  monthLabel(month: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00.000Z`)); }
  minutesLabel(value: number): string { const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours} j ${minutes} m` : `${minutes} m`; }
  timingLabel(item: PunctualityTrendItem): string {
    if (item.arrivalOffsetMinutes > 0) return `${item.arrivalOffsetMinutes} menit lebih awal`;
    if (item.arrivalOffsetMinutes < 0) return `${Math.abs(item.arrivalOffsetMinutes)} menit terlambat${item.effectiveLateMinutes === 0 ? ', efektif 0 menit karena izin' : ''}`;
    return 'Tepat waktu';
  }
  activityTitle(activity: DashboardActivity): string {
    if (activity.type === 'ATTENDANCE') return 'Absensi harian';
    if (activity.type === 'EARLY_DEPARTURE') return 'Pulang Awal';
    const labels = { SICK: 'Izin Sakit', OFFICIAL_DUTY: 'Dinas Luar', FAMILY: 'Kepentingan Keluarga', OTHER: 'Izin Lainnya', LATE_ARRIVAL: 'Izin Terlambat' } as const;
    return labels[activity.leaveType];
  }
  statusLabel(status: string): string { return ({ PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', CHECKED_IN: 'Berlangsung', COMPLETED: 'Lengkap', INCOMPLETE: 'Tidak lengkap' } as Record<string, string>)[status] ?? status; }
  attachmentUrl(activity: Extract<DashboardActivity, { type: 'LEAVE' | 'EARLY_DEPARTURE' }> | EarlyDepartureDashboardActivity): string { return this.service.attachmentUrl(activity.type, activity.id); }
}
