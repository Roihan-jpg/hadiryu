import {
  CreateGeofenceVersionRequestSchema,
  CreateScheduleVersionRequestSchema,
  type GeofenceSettingsResponse,
  type ScheduleRuleInput,
  type ScheduleSettingsResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
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
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-settings-page',
  styleUrl: './settings-page.scss',
  templateUrl: './settings-page.html',
})
export class SettingsPage implements OnInit {
  private readonly service = inject(SettingsService);

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
    effectiveFrom: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    weekday: scheduleRuleForm(),
    saturday: scheduleRuleForm(),
  });
  readonly geofenceForm = new FormGroup({
    effectiveFrom: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    latitude: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(-90), Validators.max(90)],
    }),
    longitude: new FormControl(0, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(-180), Validators.max(180)],
    }),
    radiusMeters: new FormControl(100, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(25), Validators.max(1000)],
    }),
    maxAccuracyMeters: new FormControl(50, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(5), Validators.max(200)],
    }),
  });
  readonly schedules = signal<ScheduleSettingsResponse | null>(null);
  readonly geofence = signal<GeofenceSettingsResponse | null>(null);
  readonly loading = signal(true);
  readonly actionInProgress = signal<'schedule' | 'geofence' | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  ngOnInit(): void {
    void this.loadForDate(this.inspectionDate.value);
  }

  async inspectDate(): Promise<void> {
    if (this.inspectionDate.invalid) {
      this.inspectionDate.markAsTouched();
      return;
    }
    await this.loadForDate(this.inspectionDate.value);
  }

  async saveSchedules(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }
    const input = CreateScheduleVersionRequestSchema.parse(
      this.scheduleForm.getRawValue(),
    );
    this.actionInProgress.set('schedule');
    this.clearFeedback();
    try {
      await this.service.createSchedules(input);
      this.inspectionDate.setValue(input.effectiveFrom);
      this.scheduleForm.controls.effectiveFrom.reset('');
      if (await this.loadForDate(input.effectiveFrom)) {
        this.successMessage.set('Versi jadwal baru berhasil dibuat.');
      } else {
        this.errorMessage.set(
          'Versi jadwal berhasil dibuat, tetapi tampilan terbaru belum dapat dimuat.',
        );
      }
    } catch (error) {
      this.errorMessage.set(
        this.errorText(error, 'Versi jadwal tidak dapat dibuat.'),
      );
    } finally {
      this.actionInProgress.set(null);
    }
  }

  async saveGeofence(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.geofenceForm.invalid) {
      this.geofenceForm.markAllAsTouched();
      return;
    }
    const input = CreateGeofenceVersionRequestSchema.parse(
      this.geofenceForm.getRawValue(),
    );
    this.actionInProgress.set('geofence');
    this.clearFeedback();
    try {
      await this.service.createGeofence(input);
      this.inspectionDate.setValue(input.effectiveFrom);
      this.geofenceForm.controls.effectiveFrom.reset('');
      if (await this.loadForDate(input.effectiveFrom)) {
        this.successMessage.set('Versi geofence baru berhasil dibuat.');
      } else {
        this.errorMessage.set(
          'Versi geofence berhasil dibuat, tetapi tampilan terbaru belum dapat dimuat.',
        );
      }
    } catch (error) {
      this.errorMessage.set(
        this.errorText(error, 'Versi geofence tidak dapat dibuat.'),
      );
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async loadForDate(effectiveOn: string): Promise<boolean> {
    this.loading.set(true);
    this.clearFeedback();
    try {
      const [schedules, geofence] = await Promise.all([
        this.service.getSchedules(effectiveOn),
        this.service.getGeofence(effectiveOn),
      ]);
      this.schedules.set(schedules);
      this.geofence.set(geofence);
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
        this.geofenceForm.patchValue({
          latitude: geofence.geofence.latitude,
          longitude: geofence.geofence.longitude,
          radiusMeters: geofence.geofence.radiusMeters,
          maxAccuracyMeters: geofence.geofence.maxAccuracyMeters,
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
