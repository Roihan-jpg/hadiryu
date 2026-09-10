import {
  CalendarExceptionInputSchema,
  type CalendarException,
  type CalendarExceptionsResponse,
  type GeofenceSettingsResponse,
  type GeofenceCoordinate,
  SaveGeofenceSettingsRequestSchema,
  SaveScheduleSettingsRequestSchema,
  type ScheduleRuleInput,
  type ScheduleSettingsResponse,
  SaveSecurityScheduleSettingsRequestSchema,
  type SecurityScheduleSettingsResponse,
  SaveReportingSettingsRequestSchema,
  type ReportingSettingsResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
  type ValidationErrors,
  type ValidatorFn,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { SettingsService } from './settings.service';
import { TeachersService } from '../teachers/teachers.service';
import { AdminGeofenceMap } from './admin-geofence-map';
import { focusFirstInvalidControl } from '../../../core/ui/form-focus';

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const timeKeys = [
  'checkInOpen',
  'workStart',
  'checkInClose',
  'checkoutOpen',
  'workEnd',
  'checkoutClose',
] as const;

function scheduleOrderValidator(overnight = false): ValidatorFn {
  return (
  control: AbstractControl,
): ValidationErrors | null => {
  const values = Object.fromEntries(timeKeys.map((key) => [
    key,
    control.get(key)?.value as string | undefined,
  ])) as Record<(typeof timeKeys)[number], string | undefined>;
  if (timeKeys.some((key) => !values[key] || !timePattern.test(values[key]!))) return null;
  const segments: ReadonlyArray<ReadonlyArray<(typeof timeKeys)[number]>> = overnight
    ? [['checkInOpen', 'workStart', 'checkInClose'], ['checkoutOpen', 'workEnd', 'checkoutClose']]
    : [timeKeys];
  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const previous = segment[index - 1]!;
      const current = segment[index]!;
      const toMinutes = (value: string) => {
        const [hour = '0', minute = '0'] = value.split(':');
        return Number(hour) * 60 + Number(minute);
      };
      if (toMinutes(values[current]!) < toMinutes(values[previous]!)) {
        return { timeOrder: current };
      }
    }
  }
  return null;
  };
}

function scheduleRuleForm(overnight = false) {
  return new FormGroup(
    {
      checkInOpen: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      workStart: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      checkInClose: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      checkoutOpen: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      workEnd: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      checkoutClose: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(timePattern)],
      }),
      targetMinutes: new FormControl(1, {
        nonNullable: true,
        validators: [Validators.required, Validators.min(1)],
      }),
    },
    { validators: scheduleOrderValidator(overnight) },
  );
}

const distinctRosterValidator: ValidatorFn = (control) => {
  const ids = ['dayOneMorningGuardId', 'dayOneNightGuardId', 'dayOneOffGuardId']
    .map((key) => control.get(key)?.value as string | undefined)
    .filter(Boolean);
  return ids.length === 3 && new Set(ids).size !== 3 ? { duplicateRoster: true } : null;
};

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    AdminGeofenceMap,
  ],
  selector: 'app-settings-page',
  styleUrl: './settings-page.scss',
  templateUrl: './settings-page.html',
})
export class SettingsPage implements OnInit {
  private readonly service = inject(SettingsService);
  private readonly teachersService = inject(TeachersService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly activeTab = signal<'summary' | 'schedule' | 'security' | 'geofence' | 'calendar'>('summary');
  readonly tabs = [
    { id: 'summary', label: 'Ringkasan' },
    { id: 'schedule', label: 'Jadwal Guru' },
    { id: 'security', label: 'Jadwal Satpam' },
    { id: 'geofence', label: 'Geofence' },
    { id: 'calendar', label: 'Kalender' },
  ] as const;

  readonly timeFields: ReadonlyArray<{
    key: (typeof timeKeys)[number];
    label: string;
  }> = [
    { key: 'checkInOpen', label: 'Check-in dibuka' },
    { key: 'workStart', label: 'Kerja mulai' },
    { key: 'checkInClose', label: 'Check-in ditutup' },
    { key: 'checkoutOpen', label: 'Checkout dibuka' },
    { key: 'workEnd', label: 'Kerja selesai' },
    { key: 'checkoutClose', label: 'Checkout ditutup' },
  ];
  readonly minimumEffectiveDate = this.todayInJakarta();
  readonly inspectionDate = new FormControl(this.minimumEffectiveDate, {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly scheduleForm = new FormGroup({
    weekday: scheduleRuleForm(),
    saturday: scheduleRuleForm(),
  });
  readonly securityScheduleForm = new FormGroup({
    dayShift: scheduleRuleForm(), nightShift: scheduleRuleForm(true),
    dayOneMorningGuardId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    dayOneNightGuardId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    dayOneOffGuardId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  }, { validators: distinctRosterValidator });
  readonly reportingForm = new FormGroup({
    operationalStartDate: new FormControl(this.minimumEffectiveDate, {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly geofenceForm = new FormGroup({
    maxAccuracyMeters: new FormControl(15, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(5), Validators.max(30)],
    }),
  });
  readonly geofenceVertices = signal<GeofenceCoordinate[]>([]);
  readonly calendarForm = new FormGroup({
    workDate: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    exceptionType: new FormControl<'HOLIDAY' | 'WORKING_DAY'>('HOLIDAY', {
      nonNullable: true,
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
    scheduleType: new FormControl<'WEEKDAY' | 'SATURDAY' | null>(null),
  }, { validators: (control) =>
    control.get('exceptionType')?.value === 'WORKING_DAY' && !control.get('scheduleType')?.value
      ? { scheduleRequired: true }
      : null });
  readonly schedules = signal<ScheduleSettingsResponse | null>(null);
  readonly securitySchedules = signal<SecurityScheduleSettingsResponse | null>(null);
  readonly reportingSettings = signal<ReportingSettingsResponse | null>(null);
  readonly securityGuards = signal<ReadonlyArray<{ id: string; fullName: string }>>([]);
  readonly geofence = signal<GeofenceSettingsResponse | null>(null);
  readonly calendar = signal<CalendarExceptionsResponse | null>(null);
  readonly editingCalendarId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly actionInProgress = signal<
    'reporting' | 'schedule' | 'security' | 'geofence' | 'calendar' | null
  >(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');
  readonly loadErrorMessage = signal('');
  isHistoricalInspection(): boolean {
    return this.inspectionDate.value < this.minimumEffectiveDate;
  }

  dateLabel(workDate: string | null | undefined): string {
    if (!workDate) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  }

  ngOnInit(): void {
    const requestedTab = this.route.snapshot.queryParamMap.get('tab');
    if (this.tabs.some((tab) => tab.id === requestedTab)) {
      this.activeTab.set(requestedTab as typeof this.tabs[number]['id']);
    }
    const requestedDate = this.route.snapshot.queryParamMap.get('date');
    if (requestedDate) this.inspectionDate.setValue(requestedDate);
    void this.loadForDate(this.inspectionDate.value);
  }

  selectTab(tab: typeof this.tabs[number]['id']): void {
    this.activeTab.set(tab);
    void this.syncQuery();
  }

  copyHistoricalToToday(): void {
    this.inspectionDate.setValue(this.minimumEffectiveDate);
    this.successMessage.set('Konfigurasi historis disalin sebagai draft hari ini. Tinjau lalu simpan.');
    void this.syncQuery();
  }

  guardName(guardId: string): string {
    return this.securityGuards().find((guard) => guard.id === guardId)?.fullName ?? 'Satpam tidak ditemukan';
  }

  async inspectDate(): Promise<void> {
    if (this.inspectionDate.invalid) {
      this.inspectionDate.markAsTouched();
      this.host.nativeElement.querySelector<HTMLInputElement>('[name="inspectionDate"]')?.focus();
      return;
    }
    await this.loadForDate(this.inspectionDate.value);
  }

  async saveSchedules(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      const groupName = this.scheduleForm.controls.weekday.hasError('timeOrder')
        ? 'weekday'
        : this.scheduleForm.controls.saturday.hasError('timeOrder')
          ? 'saturday'
          : null;
      if (groupName) {
        this.host.nativeElement
          .querySelector<HTMLInputElement>(`#${groupName}-checkInOpen`)
          ?.focus();
      } else {
        focusFirstInvalidControl(this.host.nativeElement);
      }
      return;
    }
    const input = SaveScheduleSettingsRequestSchema.parse(
      this.scheduleForm.getRawValue(),
    );
    this.actionInProgress.set('schedule');
    this.clearFeedback();
    try {
      const saved = await this.service.saveSchedules(input);
      this.inspectionDate.setValue(saved.effectiveOn);
      if (await this.loadForDate(saved.effectiveOn)) {
        this.successMessage.set('Jadwal berhasil disimpan.');
      } else {
        this.errorMessage.set(
          'Jadwal berhasil disimpan, tetapi tampilan terbaru belum dapat dimuat.',
        );
      }
    } catch (error) {
      this.errorMessage.set(
        this.errorText(error, 'Jadwal tidak dapat disimpan.'),
      );
    } finally {
      this.actionInProgress.set(null);
    }
  }

  async saveSecuritySchedules(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.securityScheduleForm.invalid) {
      this.securityScheduleForm.markAllAsTouched();
      const invalidShift = this.securityScheduleForm.controls.dayShift.hasError('timeOrder')
        ? `dayShift-${String(this.securityScheduleForm.controls.dayShift.getError('timeOrder'))}`
        : this.securityScheduleForm.controls.nightShift.hasError('timeOrder')
          ? `nightShift-${String(this.securityScheduleForm.controls.nightShift.getError('timeOrder'))}`
          : null;
      if (invalidShift) this.host.nativeElement.querySelector<HTMLElement>(`#${invalidShift}`)?.focus();
      else focusFirstInvalidControl(this.host.nativeElement);
      this.errorMessage.set(this.securityScheduleForm.hasError('duplicateRoster')
        ? 'Pilih tiga Satpam yang berbeda untuk roster.'
        : 'Periksa kembali field jadwal Satpam yang ditandai.');
      return;
    }
    const parsed = SaveSecurityScheduleSettingsRequestSchema.safeParse(this.securityScheduleForm.getRawValue());
    if (!parsed.success) { this.errorMessage.set('Isi dua jadwal dan pilih tiga Satpam berbeda.'); return; }
    if (!window.confirm(
      'Simpan perubahan? Tanggal server saat penyimpanan akan menjadi Hari 1 rotasi Satpam. Riwayat sebelumnya tetap sama.',
    )) return;
    this.actionInProgress.set('security'); this.clearFeedback();
    try {
      const saved = await this.service.saveSecuritySchedules(parsed.data);
      this.inspectionDate.setValue(saved.effectiveOn);
      await this.loadForDate(saved.effectiveOn);
      this.successMessage.set('Jadwal dan rotasi Satpam berhasil disimpan.');
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Jadwal Satpam tidak dapat disimpan.'));
    } finally { this.actionInProgress.set(null); }
  }

  async saveReportingSettings(): Promise<void> {
    if (this.actionInProgress() !== null || this.reportingSettings()?.locked) return;
    if (this.reportingForm.invalid) {
      this.reportingForm.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const input = SaveReportingSettingsRequestSchema.parse(
      this.reportingForm.getRawValue(),
    );
    this.actionInProgress.set('reporting');
    this.clearFeedback();
    try {
      const saved = await this.service.saveReportingSettings(input);
      this.reportingSettings.set(saved);
      this.reportingForm.patchValue({
        operationalStartDate: saved.operationalStartDate ?? input.operationalStartDate,
      });
      this.successMessage.set(
        'Tanggal mulai operasional laporan berhasil disimpan.',
      );
    } catch (error) {
      this.errorMessage.set(
        this.errorText(error, 'Tanggal mulai operasional tidak dapat disimpan.'),
      );
    } finally {
      this.actionInProgress.set(null);
    }
  }

  async saveGeofence(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.geofenceForm.invalid) {
      this.geofenceForm.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const parsed = SaveGeofenceSettingsRequestSchema.safeParse({
      shape: 'POLYGON',
      vertices: this.geofenceVertices(),
      ...this.geofenceForm.getRawValue(),
    });
    if (!parsed.success) {
      this.errorMessage.set(
        'Zona absensi harus memiliki 3–32 titik unik tanpa garis berpotongan.',
      );
      return;
    }
    const input = parsed.data;
    this.actionInProgress.set('geofence');
    this.clearFeedback();
    try {
      const saved = await this.service.saveGeofence(input);
      this.inspectionDate.setValue(saved.effectiveOn);
      if (await this.loadForDate(saved.effectiveOn)) {
        this.successMessage.set('Geofence berhasil disimpan.');
      } else {
        this.errorMessage.set(
          'Geofence berhasil disimpan, tetapi tampilan terbaru belum dapat dimuat.',
        );
      }
    } catch (error) {
      this.errorMessage.set(
        this.errorText(error, 'Geofence tidak dapat disimpan.'),
      );
    } finally {
      this.actionInProgress.set(null);
    }
  }

  updateGeofenceVertices(vertices: GeofenceCoordinate[]): void {
    this.geofenceVertices.set(vertices);
    this.clearFeedback();
  }

  undoGeofenceVertex(): void {
    this.geofenceVertices.update((vertices) => vertices.slice(0, -1));
  }

  clearGeofenceVertices(): void {
    this.geofenceVertices.set([]);
  }

  removeGeofenceVertex(index: number): void {
    this.geofenceVertices.update((vertices) =>
      vertices.filter((_, vertexIndex) => vertexIndex !== index),
    );
  }

  geofenceMapCenter(): GeofenceCoordinate {
    const rule = this.geofence()?.geofence;
    if (rule?.shape === 'CIRCLE') {
      return { latitude: rule.latitude, longitude: rule.longitude };
    }
    return rule?.vertices[0] ?? { latitude: -8.1328, longitude: 113.2219 };
  }

  async saveCalendarException(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.calendarForm.invalid) {
      this.calendarForm.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const input = CalendarExceptionInputSchema.parse({
      ...this.calendarForm.getRawValue(),
      name: this.calendarForm.controls.name.value.trim(),
      scheduleType:
        this.calendarForm.controls.exceptionType.value === 'HOLIDAY'
          ? null
          : this.calendarForm.controls.scheduleType.value,
    });
    this.actionInProgress.set('calendar');
    this.clearFeedback();
    try {
      const existingId = this.editingCalendarId();
      if (existingId) {
        await this.service.updateCalendarException(existingId, input);
      } else {
        await this.service.createCalendarException(input);
      }
      this.resetCalendarForm();
      if (await this.loadForDate(this.inspectionDate.value)) {
        this.successMessage.set(
          existingId
            ? 'Aturan kalender berhasil diperbarui.'
            : 'Aturan kalender berhasil ditambahkan.',
        );
      }
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Aturan kalender tidak dapat disimpan.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  editCalendarException(exception: CalendarException): void {
    this.editingCalendarId.set(exception.id);
    this.calendarForm.setValue({
      workDate: exception.workDate,
      exceptionType: exception.exceptionType,
      name: exception.name,
      scheduleType: exception.scheduleType,
    });
  }

  cancelCalendarEdit(): void {
    this.resetCalendarForm();
  }

  async deleteCalendarException(exception: CalendarException): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (!window.confirm(`Hapus aturan kalender “${exception.name}”?`)) return;
    this.actionInProgress.set('calendar');
    this.clearFeedback();
    try {
      await this.service.deleteCalendarException(exception.id);
      if (this.editingCalendarId() === exception.id) this.resetCalendarForm();
      if (await this.loadForDate(this.inspectionDate.value)) {
        this.successMessage.set('Aturan kalender berhasil dihapus.');
      }
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Aturan kalender tidak dapat dihapus.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async loadForDate(effectiveOn: string): Promise<boolean> {
    this.loading.set(true);
    this.clearFeedback();
    this.loadErrorMessage.set('');
    try {
      const [reportingSettings, schedules, securitySchedules, geofence, calendar, guards] = await Promise.all([
        this.service.getReportingSettings(),
        this.service.getSchedules(effectiveOn),
        this.service.getSecuritySchedules(effectiveOn),
        this.service.getGeofence(effectiveOn),
        this.service.getCalendarExceptions(),
        this.teachersService.list({ page: 1, pageSize: 100, role: 'SECURITY_GUARD' }),
      ]);
      this.reportingSettings.set(reportingSettings);
      this.schedules.set(schedules);
      this.securitySchedules.set(securitySchedules);
      this.securityGuards.set(guards.data.map((guard) => ({ id: guard.id, fullName: guard.fullName })));
      this.geofence.set(geofence);
      this.calendar.set(calendar);
      if (reportingSettings.operationalStartDate) {
        this.reportingForm.patchValue({
          operationalStartDate: reportingSettings.operationalStartDate,
        });
      }
      void this.syncQuery();
      if (schedules.weekday) {
        this.scheduleForm.controls.weekday.patchValue(
          this.scheduleInput(schedules.weekday),
        );
      }
      if (schedules.saturday) {
        this.scheduleForm.controls.saturday.patchValue(
          this.scheduleInput(schedules.saturday),
        );
      }
      if (securitySchedules.dayShift && securitySchedules.nightShift && securitySchedules.roster) {
        this.securityScheduleForm.patchValue({
          dayShift: this.scheduleInput(securitySchedules.dayShift),
          nightShift: this.scheduleInput(securitySchedules.nightShift),
          dayOneMorningGuardId: securitySchedules.roster.dayOneMorningGuardId,
          dayOneNightGuardId: securitySchedules.roster.dayOneNightGuardId,
          dayOneOffGuardId: securitySchedules.roster.dayOneOffGuardId,
        });
      } else {
        this.securityScheduleForm.controls.dayShift.patchValue({ workStart: '06:00', targetMinutes: 720 });
        this.securityScheduleForm.controls.nightShift.patchValue({ workStart: '18:00', targetMinutes: 720 });
      }
      if (geofence.geofence) {
        const rule = geofence.geofence;
        this.geofenceVertices.set(rule.shape === 'POLYGON' ? [...rule.vertices] : []);
        this.geofenceForm.patchValue({
          maxAccuracyMeters: rule.shape === 'POLYGON'
            ? rule.maxAccuracyMeters
            : 15,
        });
      }
      return true;
    } catch (error) {
      this.loadErrorMessage.set(
        this.errorText(error, 'Pengaturan tidak dapat dimuat.'),
      );
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  private async syncQuery(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: this.activeTab(), date: this.inspectionDate.value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private scheduleInput(rule: ScheduleRuleInput): ScheduleRuleInput {
    return {
      checkInOpen: rule.checkInOpen,
      workStart: rule.workStart,
      checkInClose: rule.checkInClose,
      checkoutOpen: rule.checkoutOpen,
      workEnd: rule.workEnd,
      checkoutClose: rule.checkoutClose,
      targetMinutes: rule.targetMinutes,
    };
  }

  private clearFeedback(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  private resetCalendarForm(): void {
    this.editingCalendarId.set(null);
    this.calendarForm.reset({
      workDate: '',
      exceptionType: 'HOLIDAY',
      name: '',
      scheduleType: null,
    });
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = (error.error as { error?: { message?: unknown } } | null)
        ?.error?.message;
      if (typeof message === 'string') return message;
    }
    return fallback;
  }

  private todayInJakarta(): string {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}
