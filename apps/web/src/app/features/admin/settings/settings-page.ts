import {
  CalendarExceptionInputSchema,
  type CalendarException,
  type CalendarExceptionsResponse,
  CreatePayrollVersionRequestSchema,
  CreateGeofenceVersionRequestSchema,
  CreateScheduleVersionRequestSchema,
  type GeofenceSettingsResponse,
  type PayrollSettingsResponse,
  type ScheduleRuleInput,
  type ScheduleSettingsResponse,
} from '@absensi/contracts';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
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

const monthStartValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'string' && control.value !== '' && !control.value.endsWith('-01')
    ? { monthStart: true }
    : null;

const payrollMinimumValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const base = Number(control.get('basePerformancePay')?.value);
  const minimum = Number(control.get('minimumPerformancePay')?.value);
  return Number.isFinite(base) && Number.isFinite(minimum) && minimum > base
    ? { minimumExceedsBase: true }
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
  readonly payrollForm = new FormGroup({
    effectiveFrom: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, monthStartValidator],
    }),
    basePerformancePay: new FormControl(600_000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    minimumPerformancePay: new FormControl(300_000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    lateDeductionAmount: new FormControl(10_000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    absentDeductionAmount: new FormControl(20_000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    rejectedEarlyDepartureRatePerHour: new FormControl(10_000, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
  }, { validators: payrollMinimumValidator });
  readonly schedules = signal<ScheduleSettingsResponse | null>(null);
  readonly geofence = signal<GeofenceSettingsResponse | null>(null);
  readonly calendar = signal<CalendarExceptionsResponse | null>(null);
  readonly payroll = signal<PayrollSettingsResponse | null>(null);
  readonly editingCalendarId = signal<string | null>(null);
  readonly loading = signal(true);
  readonly actionInProgress = signal<
    'schedule' | 'geofence' | 'calendar' | 'payroll' | null
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

  currencyLabel(value: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 2,
    }).format(value);
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
      focusFirstInvalidControl(this.host.nativeElement);
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

  async savePayroll(): Promise<void> {
    if (this.actionInProgress() !== null) return;
    if (this.payrollForm.invalid) {
      this.payrollForm.markAllAsTouched();
      focusFirstInvalidControl(this.host.nativeElement);
      return;
    }
    const input = CreatePayrollVersionRequestSchema.parse(this.payrollForm.getRawValue());
    this.actionInProgress.set('payroll');
    this.clearFeedback();
    try {
      await this.service.createPayroll(input);
      this.inspectionDate.setValue(input.effectiveFrom);
      this.payrollForm.controls.effectiveFrom.reset('');
      if (await this.loadForDate(input.effectiveFrom)) {
        this.successMessage.set('Versi upah baru berhasil dibuat.');
      }
    } catch (error) {
      this.errorMessage.set(this.errorText(error, 'Versi upah tidak dapat dibuat.'));
    } finally {
      this.actionInProgress.set(null);
    }
  }

  private async loadForDate(effectiveOn: string): Promise<boolean> {
    this.loading.set(true);
    this.clearFeedback();
    try {
      const [schedules, geofence, calendar, payroll] = await Promise.all([
        this.service.getSchedules(effectiveOn),
        this.service.getGeofence(effectiveOn),
        this.service.getCalendarExceptions(),
        this.service.getPayroll(effectiveOn),
      ]);
      this.schedules.set(schedules);
      this.geofence.set(geofence);
      this.calendar.set(calendar);
      this.payroll.set(payroll);
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
      if (payroll.payrollRule) {
        this.payrollForm.patchValue({
          basePerformancePay: payroll.payrollRule.basePerformancePay,
          minimumPerformancePay: payroll.payrollRule.minimumPerformancePay,
          lateDeductionAmount: payroll.payrollRule.lateDeductionAmount,
          absentDeductionAmount: payroll.payrollRule.absentDeductionAmount,
          rejectedEarlyDepartureRatePerHour:
            payroll.payrollRule.rejectedEarlyDepartureRatePerHour,
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
