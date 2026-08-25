import type {
  CreateGeofenceVersionRequest,
  CreateScheduleVersionRequest,
  GeofenceSettingsResponse,
  ScheduleSettingsResponse,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { SettingsPage } from './settings-page';
import { SettingsService } from './settings.service';

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
    latitude: -6.2,
    longitude: 106.816666,
    radiusMeters: 100,
    maxAccuracyMeters: 50,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  },
};

describe('SettingsPage', () => {
  let fixture: ComponentFixture<SettingsPage>;
  const getSchedules = vi.fn(async () => schedules);
  const getGeofence = vi.fn(async () => geofence);
  const createSchedules = vi.fn(
    async (input: CreateScheduleVersionRequest) => ({
      ...schedules,
      effectiveOn: input.effectiveFrom,
    }),
  );
  const createGeofence = vi.fn(
    async (input: CreateGeofenceVersionRequest) => ({
      ...geofence,
      effectiveOn: input.effectiveFrom,
    }),
  );

  beforeEach(async () => {
    getSchedules.mockClear();
    getGeofence.mockClear();
    createSchedules.mockClear();
    createGeofence.mockClear();
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [
        provideRouter([]),
        {
          provide: SettingsService,
          useValue: {
            getSchedules,
            getGeofence,
            createSchedules,
            createGeofence,
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
    expect(text).toContain('Radius 100 meter');
  });

  it('resolves both settings for a selected historical date', async () => {
    fixture.componentInstance.inspectionDate.setValue('2026-01-31');
    await fixture.componentInstance.inspectDate();

    expect(getSchedules).toHaveBeenLastCalledWith('2026-01-31');
    expect(getGeofence).toHaveBeenLastCalledWith('2026-01-31');
  });

  it('blocks an invalid schedule order before calling the API', async () => {
    fixture.componentInstance.scheduleForm.patchValue({
      effectiveFrom: '2026-09-01',
      weekday: { checkInOpen: '07:00', workStart: '06:00' },
    });
    await fixture.componentInstance.saveSchedules();

    expect(createSchedules).not.toHaveBeenCalled();
    expect(fixture.componentInstance.scheduleForm.invalid).toBe(true);
  });

  it('creates new schedule and geofence versions through separate forms', async () => {
    fixture.componentInstance.scheduleForm.patchValue({
      effectiveFrom: '2026-09-01',
    });
    await fixture.componentInstance.saveSchedules();
    expect(createSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveFrom: '2026-09-01',
        weekday: expect.objectContaining({ targetMinutes: 515 }),
        saturday: expect.objectContaining({ targetMinutes: 215 }),
      }),
    );

    fixture.componentInstance.geofenceForm.patchValue({
      effectiveFrom: '2026-10-01',
      radiusMeters: 125,
    });
    await fixture.componentInstance.saveGeofence();
    expect(createGeofence).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveFrom: '2026-10-01', radiusMeters: 125 }),
    );
  });

  it('prevents duplicate submissions while a version request is running', async () => {
    let finish!: (value: ScheduleSettingsResponse) => void;
    createSchedules.mockImplementationOnce(
      () => new Promise<ScheduleSettingsResponse>((resolve) => (finish = resolve)),
    );
    fixture.componentInstance.scheduleForm.patchValue({
      effectiveFrom: '2026-09-01',
    });

    const first = fixture.componentInstance.saveSchedules();
    const second = fixture.componentInstance.saveSchedules();
    expect(createSchedules).toHaveBeenCalledTimes(1);
    finish({ ...schedules, effectiveOn: '2026-09-01' });
    await Promise.all([first, second]);
  });
});
