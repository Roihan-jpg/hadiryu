import type {
  DashboardActivity,
  DashboardActivityFilter,
  AttendanceTrendDay,
  EarlyDepartureDashboardActivity,
  TeacherStreak,
} from '@absensi/contracts';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { createIndonesianPaginatorIntl } from '../../core/ui/paginator-intl';
import { StaffDashboardService } from './staff-dashboard.service';

type StreakTier = Extract<TeacherStreak, { status: 'AVAILABLE' }>['tier'];
type AnimatedStreakTier = Exclude<StreakTier, 'NONE'>;

const STREAK_ANIMATION_BASE_URL = '/assets/streak';

function animatedStreakTier(streak: TeacherStreak | null | undefined): AnimatedStreakTier | null {
  return streak?.status === 'AVAILABLE' && streak.tier !== 'NONE' ? streak.tier : null;
}

export function streakAnimationUrl(streak: TeacherStreak | null | undefined): string | null {
  const tier = animatedStreakTier(streak);
  if (!tier) return null;
  const fileName: Record<AnimatedStreakTier, string> = {
    RED: 'api-merah.webm',
    BLUE: 'api-biru.webm',
    PURPLE: 'api-merah.webm',
  };
  return `${STREAK_ANIMATION_BASE_URL}/${fileName[tier]}`;
}

function currentJakartaMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}`;
}

@Component({
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatPaginatorModule, ReactiveFormsModule, RouterLink],
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
  readonly failedStreakAnimationTier = signal<AnimatedStreakTier | null>(null);
  readonly attendanceTrend = computed(() => this.dashboard()?.attendanceTrend ?? []);
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

  readonly workDateLabel = computed(() => {
    const workDate = this.dashboard()?.todayAttendance.workDate;
    if (!workDate) return '';
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'full',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  });

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
  streakAnimationUrl(streak: TeacherStreak | null | undefined): string | null { return streakAnimationUrl(streak); }
  streakAnimationFailed(streak: TeacherStreak | null | undefined): boolean {
    const tier = animatedStreakTier(streak);
    return tier !== null && this.failedStreakAnimationTier() === tier;
  }
  markStreakAnimationFailed(streak: TeacherStreak | null | undefined): void {
    const tier = animatedStreakTier(streak);
    if (tier) this.failedStreakAnimationTier.set(tier);
  }
  jakartaTime(timestamp: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)); }
  dateLabel(workDate: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${workDate}T00:00:00.000Z`)); }
  monthLabel(month: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00.000Z`)); }
  minutesLabel(value: number): string { const hours = Math.floor(value / 60); const minutes = value % 60; return hours ? `${hours} j ${minutes} m` : `${minutes} m`; }
  timingLabel(item: { arrivalOffsetMinutes: number } | null, effectiveLateMinutes?: number): string {
    if (!item) return 'Tidak ada Absen Masuk';
    if (item.arrivalOffsetMinutes > 0) return `${item.arrivalOffsetMinutes} menit lebih awal`;
    if (item.arrivalOffsetMinutes < 0) return `${Math.abs(item.arrivalOffsetMinutes)} menit terlambat${effectiveLateMinutes === 0 ? ', efektif 0 menit karena izin' : ''}`;
    return 'Tepat waktu';
  }
  arrivalBarSize(offsetMinutes: number): number { return Math.max(4, Math.min(92, Math.abs(offsetMinutes) * 3)); }
  workedHeight(day: AttendanceTrendDay, kind: 'actual' | 'effective'): number {
    const value = day[kind]?.workedMinutes;
    if (value === null || value === undefined || !day.targetMinutes) return 0;
    return Math.max(4, Math.min(100, Math.round(value / day.targetMinutes * 100)));
  }
  deficitHeight(day: AttendanceTrendDay, kind: 'actual' | 'effective'): number {
    const value = day[kind]?.workDeficitMinutes;
    if (value === null || value === undefined || !day.targetMinutes) return 0;
    return Math.max(3, Math.min(100, Math.round(value / day.targetMinutes * 100)));
  }
  trendStatusLabel(status: AttendanceTrendDay['status']): string {
    return ({
      COMPLETED: 'Hadir lengkap', CHECKED_IN: 'Sedang bekerja', INCOMPLETE: 'Belum checkout',
      LEAVE_PENDING: 'Izin menunggu', LEAVE_APPROVED: 'Izin disetujui', LEAVE_REJECTED: 'Izin ditolak',
      ABSENT: 'Alpa', OPEN: 'Menunggu Absen Masuk', NON_WORKING_DAY: 'Libur', FUTURE: 'Tanggal mendatang',
      CONFIGURATION_MISSING: 'Jadwal belum tersedia', NOT_TRACKED: 'Belum berlaku',
    } as Record<AttendanceTrendDay['status'], string>)[status];
  }
  trendAriaLabel(day: AttendanceTrendDay): string {
    const status = this.trendStatusLabel(day.status);
    if (!day.actual || !day.effective) return `${this.dateLabel(day.workDate)}: ${status}.`;
    const credit = [day.credit.lateArrival ? 'Izin terlambat memberi kredit' : '', day.credit.earlyDeparture ? 'Pulang awal memberi kredit' : '']
      .filter(Boolean).join('. ');
    return `${this.dateLabel(day.workDate)}: ${status}. Absen Masuk ${this.jakartaTime(day.actual.checkInAt)} WIB; ${day.actual.checkOutAt ? `Absen Pulang ${this.jakartaTime(day.actual.checkOutAt)} WIB` : 'Absen Pulang belum tercatat'}. Datang aktual ${this.timingLabel(day.actual, day.effective.lateMinutes)}; durasi aktual ${this.minutesLabel(day.actual.workedMinutes ?? 0)}, efektif ${this.minutesLabel(day.effective.workedMinutes ?? 0)}; kekurangan aktual ${this.minutesLabel(day.actual.workDeficitMinutes ?? 0)}, efektif ${this.minutesLabel(day.effective.workDeficitMinutes ?? 0)}.${credit ? ` ${credit}.` : ''}`;
  }
  activityTitle(activity: DashboardActivity): string {
    if (activity.type === 'ATTENDANCE') return 'Absensi harian';
    if (activity.type === 'EARLY_DEPARTURE') return 'Pulang Awal';
    const labels = { SICK: 'Izin Sakit', OFFICIAL_DUTY: 'Dinas Luar', FAMILY: 'Kepentingan Keluarga', OTHER: 'Izin Lainnya', LATE_ARRIVAL: 'Izin Terlambat', MATERNITY_LEAVE: 'Cuti Melahirkan' } as const;
    return labels[activity.leaveType];
  }
  statusLabel(status: string): string { return ({ PENDING: 'Menunggu', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', CHECKED_IN: 'Berlangsung', COMPLETED: 'Lengkap', INCOMPLETE: 'Tidak lengkap' } as Record<string, string>)[status] ?? status; }
  attachmentUrl(activity: Extract<DashboardActivity, { type: 'LEAVE' | 'EARLY_DEPARTURE' }> | EarlyDepartureDashboardActivity): string { return this.service.attachmentUrl(activity.type, activity.id); }

  profilePhotoUrl(updatedAt: string): string {
    return `/api/profile/photo?v=${encodeURIComponent(updatedAt)}`;
  }

  initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('');
  }
}
