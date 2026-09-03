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
import { RouterLink } from '@angular/router';

import { SettingsService } from './settings.service';
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

const scheduleOrderValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const values = timeKeys.map((key) => control.get(key)?.value as string | undefined);
  if (values.some((value) => !value || !timePattern.test(value))) return null;
  const minutes = values.map((value) => {
    const [hour = '0', minute = '0'] = value!.split(':');
    return Number(hour) * 60 + Number(minute);
  });
  return minutes.some((value, index) => index > 0 && value < minutes[index - 1]!)
    ? { timeOrder: true }
    : null;
};

function scheduleRuleForm() {
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
    { validators: scheduleOrderValidator },
  );
}

@Component({
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
  readonly geofence = signal<GeofenceSettingsResponse | null>(null);
  readonly calendar = signal<CalendarExceptionsResponse | null>(null);
  readonly editingCalendarId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly actionInProgress = signal<
    'schedule' | 'geofence' | 'calendar' | null
  >(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  dateLabel(workDate: string | null | undefined): string {
    if (!workDate) return '—';
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${workDate}T00:00:00.000Z`));
  }

  ngOnInit(): void {
    void this.loadForDate(this.inspectionDate.value);
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
    try {
      const [schedules, geofence, calendar] = await Promise.all([
        this.service.getSchedules(effectiveOn),
        this.service.getGeofence(effectiveOn),
        this.service.getCalendarExceptions(),
      ]);
      this.schedules.set(schedules);
      this.geofence.set(geofence);
      this.calendar.set(calendar);
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
      this.errorMessage.set(
        this.errorText(error, 'Pengaturan tidak dapat dimuat.'),
      );
      return false;
    } finally {
      this.loading.set(false);
    }
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
