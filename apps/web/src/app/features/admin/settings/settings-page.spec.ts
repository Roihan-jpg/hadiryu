import type {
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  ScheduleSettingsResponse,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { SettingsPage } from './settings-page';
import { SettingsService } from './settings.service';
import { ADMIN_GEOFENCE_LEAFLET } from './admin-geofence-map';

const schedules: ScheduleSettingsResponse = {
  effectiveOn: '2026-08-25',
  weekday: {
    id: '10000000-0000-4000-8000-000000000031',
    scheduleType: 'WEEKDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '12:00',
    workEnd: '15:35',
    checkoutClose: '17:00',
    targetMinutes: 515,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  },
  saturday: {
    id: '10000000-0000-4000-8000-000000000032',
    scheduleType: 'SATURDAY',
    checkInOpen: '05:30',
    workStart: '07:00',
    checkInClose: '08:00',
    checkoutOpen: '09:30',
    workEnd: '10:35',
    checkoutClose: '12:00',
    targetMinutes: 215,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  },
};

const geofence: GeofenceSettingsResponse = {
  effectiveOn: '2026-08-25',
  geofence: {
    id: '20000000-0000-4000-8000-000000000031',
    shape: 'CIRCLE',
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 100,
    maxAccuracyMeters: 50,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  },
};
const calendar: CalendarExceptionsResponse = { exceptions: [] };

describe('SettingsPage', () => {
  let fixture: ComponentFixture<SettingsPage>;
  const getSchedules = vi.fn(async () => schedules);
  const getGeofence = vi.fn(async () => geofence);
  const saveSchedules = vi.fn(
    async () => ({
      ...schedules,
      effectiveOn: '2026-09-01',
    }),
  );
  const saveGeofence = vi.fn(
    async () => ({
      ...geofence,
      effectiveOn: '2026-09-01',
    }),
  );
  const getCalendarExceptions = vi.fn(async () => calendar);
  const createCalendarException = vi.fn(
    async (input: CalendarExceptionInput) => ({
      id: '40000000-0000-4000-8000-000000000001',
      ...input,
    }),
  );
  const updateCalendarException = vi.fn();
  const deleteCalendarException = vi.fn();

  beforeEach(async () => {
    getSchedules.mockClear();
    getGeofence.mockClear();
    saveSchedules.mockClear();
    saveGeofence.mockClear();
    getCalendarExceptions.mockClear();
    createCalendarException.mockClear();
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        {
          provide: SettingsService,
          useValue: {
            getSchedules,
            getGeofence,
            saveSchedules,
            saveGeofence,
            getCalendarExceptions,
            createCalendarException,
            updateCalendarException,
            deleteCalendarException,
          },
        },
        {
          provide: ADMIN_GEOFENCE_LEAFLET,
          useValue: {
            map: vi.fn(() => ({
              fitBounds: vi.fn(), off: vi.fn(), on: vi.fn(), remove: vi.fn(), setView: vi.fn(),
            })),
            tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
            circleMarker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
            polygon: vi.fn(() => ({ addTo: vi.fn(), getBounds: vi.fn(), remove: vi.fn() })),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
  });

  it('renders WEEKDAY, SATURDAY, and the single geofence', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Senin–Jumat');
    expect(text).toContain('Sabtu');
    expect(text).toContain('515 menit');
    expect(text).toContain('Lingkaran lama');
    expect(text).not.toContain('Upah kinerja');
    expect(fixture.nativeElement.querySelector('[name="scheduleEffectiveFrom"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[name="geofenceEffectiveFrom"]')).toBeNull();
  });

  it('resolves both settings for a selected historical date', async () => {
    fixture.componentInstance.inspectionDate.setValue('2026-01-31');
    await fixture.componentInstance.inspectDate();

    expect(getSchedules).toHaveBeenLastCalledWith('2026-01-31');
    expect(getGeofence).toHaveBeenLastCalledWith('2026-01-31');
  });

  it('blocks an invalid schedule order before calling the API', async () => {
    fixture.componentInstance.scheduleForm.patchValue({
      weekday: { checkInOpen: '07:00', workStart: '06:00' },
    });
    fixture.detectChanges();
    await fixture.componentInstance.saveSchedules();

    expect(saveSchedules).not.toHaveBeenCalled();
    expect(fixture.componentInstance.scheduleForm.invalid).toBe(true);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector(
        '#weekday-checkInOpen',
      ),
    );
  });

  it('saves schedule and geofence settings without effective dates', async () => {
    await fixture.componentInstance.saveSchedules();
    expect(saveSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        weekday: expect.objectContaining({ targetMinutes: 515 }),
        saturday: expect.objectContaining({ targetMinutes: 215 }),
      }),
    );

    fixture.componentInstance.updateGeofenceVertices([
      { latitude: -8.1330, longitude: 113.2218 },
      { latitude: -8.1330, longitude: 113.2221 },
      { latitude: -8.1327, longitude: 113.2221 },
      { latitude: -8.1327, longitude: 113.2218 },
    ]);
    await fixture.componentInstance.saveGeofence();
    expect(saveGeofence).toHaveBeenCalledWith(
      expect.objectContaining({ shape: 'POLYGON', maxAccuracyMeters: 15 }),
    );
    expect(fixture.componentInstance.inspectionDate.value).toBe('2026-09-01');
  });

  it('prevents duplicate submissions while a version request is running', async () => {
    let finish!: (value: ScheduleSettingsResponse) => void;
    saveSchedules.mockImplementationOnce(
      () => new Promise<ScheduleSettingsResponse>((resolve) => (finish = resolve)),
    );
    const first = fixture.componentInstance.saveSchedules();
    const second = fixture.componentInstance.saveSchedules();
    expect(saveSchedules).toHaveBeenCalledTimes(1);
    finish({ ...schedules, effectiveOn: '2026-09-01' });
    await Promise.all([first, second]);
  });

  it('creates a calendar exception without exposing payroll settings', async () => {
    fixture.componentInstance.calendarForm.patchValue({
      workDate: '2026-12-25',
      exceptionType: 'HOLIDAY',
      name: 'Libur Natal',
      scheduleType: null,
    });
    await fixture.componentInstance.saveCalendarException();
    expect(createCalendarException).toHaveBeenCalledWith({
      workDate: '2026-12-25',
      exceptionType: 'HOLIDAY',
      name: 'Libur Natal',
      scheduleType: null,
    });

    expect(fixture.nativeElement.textContent).not.toContain('Upah kinerja');
  });

  it('edits and confirms deletion of a calendar exception', async () => {
    const exception = {
      id: '40000000-0000-4000-8000-000000000001',
      workDate: '2026-12-25',
      exceptionType: 'HOLIDAY' as const,
      name: 'Libur Natal',
      scheduleType: null,
    };
    fixture.componentInstance.editCalendarException(exception);
    fixture.componentInstance.calendarForm.controls.name.setValue('Libur Nasional');
    await fixture.componentInstance.saveCalendarException();
    expect(updateCalendarException).toHaveBeenCalledWith(exception.id, {
      workDate: exception.workDate,
      exceptionType: exception.exceptionType,
      name: 'Libur Nasional',
      scheduleType: exception.scheduleType,
    });

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await fixture.componentInstance.deleteCalendarException(exception);
    expect(deleteCalendarException).toHaveBeenCalledWith(exception.id);
  });
});
