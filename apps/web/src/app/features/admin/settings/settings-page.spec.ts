import type {
  CalendarExceptionInput,
  CalendarExceptionsResponse,
  GeofenceSettingsResponse,
  ScheduleSettingsResponse,
  SecurityScheduleSettingsResponse,
  ReportingSettingsResponse,
  GeofenceTemplate,
} from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { SettingsPage } from './settings-page';
import { SettingsService } from './settings.service';
import { ADMIN_GEOFENCE_LEAFLET } from './admin-geofence-map';
import { TeachersService } from '../teachers/teachers.service';

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
const template: GeofenceTemplate = {
  id: '20000000-0000-4000-8000-000000000099', name: 'Halaman Utama', shape: 'POLYGON',
  vertices: [
    { latitude: -8.1330, longitude: 113.2218 },
    { latitude: -8.1330, longitude: 113.2221 },
    { latitude: -8.1327, longitude: 113.2221 },
  ],
  maxAccuracyMeters: 15, isActive: false,
  createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
};
const calendar: CalendarExceptionsResponse = { exceptions: [] };
const reportingSettings: ReportingSettingsResponse = {
  operationalStartDate: '2026-09-07',
  locked: false,
};
const guardIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;
const securitySchedules: SecurityScheduleSettingsResponse = {
  effectiveOn: '2026-08-25',
  dayShift: {
    id: '50000000-0000-4000-8000-000000000001', scheduleType: 'SECURITY_DAY',
    checkInOpen: '05:00', workStart: '06:00', checkInClose: '08:00', checkoutOpen: '17:00', workEnd: '18:00', checkoutClose: '20:00', targetMinutes: 720,
    effectiveFrom: '2026-01-01', effectiveTo: null,
  },
  nightShift: {
    id: '50000000-0000-4000-8000-000000000001', scheduleType: 'SECURITY_NIGHT',
    checkInOpen: '17:00', workStart: '18:00', checkInClose: '20:00', checkoutOpen: '05:00', workEnd: '06:00', checkoutClose: '08:00', targetMinutes: 720,
    effectiveFrom: '2026-01-01', effectiveTo: null,
  },
  roster: {
    dayOneMorningGuardId: guardIds[0], dayOneNightGuardId: guardIds[1], dayOneOffGuardId: guardIds[2],
    effectiveFrom: '2026-01-01', effectiveTo: null,
  },
  preview: [
    { workDate: '2026-08-25', rotationDay: 1, morningGuardId: guardIds[0], nightGuardId: guardIds[1], offGuardId: guardIds[2] },
    { workDate: '2026-08-26', rotationDay: 2, morningGuardId: guardIds[2], nightGuardId: guardIds[0], offGuardId: guardIds[1] },
    { workDate: '2026-08-27', rotationDay: 3, morningGuardId: guardIds[1], nightGuardId: guardIds[2], offGuardId: guardIds[0] },
  ],
};

describe('SettingsPage', () => {
  let fixture: ComponentFixture<SettingsPage>;
  const getSchedules = vi.fn(async () => schedules);
  const getGeofence = vi.fn(async () => geofence);
  const getSecuritySchedules = vi.fn(async () => securitySchedules);
  const getReportingSettings = vi.fn(async () => reportingSettings);
  const saveReportingSettings = vi.fn(async () => reportingSettings);
  const saveSecuritySchedules = vi.fn(async () => ({ ...securitySchedules, effectiveOn: '2026-09-01' }));
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
  const getGeofenceTemplates = vi.fn(async () => ({ templates: [template] }));
  const createGeofenceTemplate = vi.fn(async () => template);
  const updateGeofenceTemplate = vi.fn(async () => template);
  const deleteGeofenceTemplate = vi.fn(async () => undefined);
  const activateGeofenceTemplate = vi.fn(async () => ({ ...geofence, effectiveOn: '2026-09-01' }));
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
    getSecuritySchedules.mockClear();
    getReportingSettings.mockClear();
    saveReportingSettings.mockClear();
    saveSecuritySchedules.mockClear();
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
            getReportingSettings,
            saveReportingSettings,
            getSchedules,
            getSecuritySchedules,
            saveSecuritySchedules,
            getGeofence,
            saveSchedules,
            saveGeofence,
            getGeofenceTemplates,
            createGeofenceTemplate,
            updateGeofenceTemplate,
            deleteGeofenceTemplate,
            activateGeofenceTemplate,
            getCalendarExceptions,
            createCalendarException,
            updateCalendarException,
            deleteCalendarException,
          },
        },
        {
          provide: TeachersService,
          useValue: {
            list: vi.fn(async () => ({
              data: guardIds.map((id, index) => ({ id, fullName: ['Mujib', 'Wahid', 'Zainur'][index] })),
              pagination: { page: 1, pageSize: 100, totalItems: 3, totalPages: 1 },
            })),
          },
        },
        {
          provide: ADMIN_GEOFENCE_LEAFLET,
          useValue: {
            map: vi.fn(() => ({
              fitBounds: vi.fn(), off: vi.fn(), on: vi.fn(), remove: vi.fn(), setView: vi.fn(),
            })),
            tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
            circle: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
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

  afterEach(() => vi.unstubAllGlobals());

  it('renders WEEKDAY, SATURDAY, and the single geofence', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Senin–Jumat');
    expect(text).toContain('Sabtu');
    expect(text).toContain('515 menit');
    expect(text).toContain('Lingkaran lama');
    expect(text).toContain('Mulai operasional laporan');
    expect(fixture.componentInstance.reportingForm.controls.operationalStartDate.value).toBe('2026-09-07');
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

  it('keeps the settings page available when geofence templates are not migrated yet', async () => {
    getGeofenceTemplates.mockRejectedValueOnce(new Error('relation geofence_templates does not exist'));
    fixture.componentInstance.inspectionDate.setValue('2026-01-31');

    await fixture.componentInstance.inspectDate();

    expect(fixture.componentInstance.loadErrorMessage()).toBe('');
    expect(fixture.componentInstance.schedules()?.effectiveOn).toBe('2026-08-25');
    expect(fixture.componentInstance.geofenceTemplates()).toEqual({ templates: [] });
  });

  it('renders only the active accessible tab panel', () => {
    expect(fixture.nativeElement.querySelector('[aria-labelledby="security-schedule-title"]')).toBeNull();
    fixture.componentInstance.selectTab('security');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Jadwal dan rotasi Satpam');
    expect(fixture.nativeElement.textContent).not.toContain('Geofence global');
  });

  it('accepts an overnight shift and displays next-day hints plus rotation preview', async () => {
    fixture.componentInstance.selectTab('security');
    fixture.detectChanges();

    expect(fixture.componentInstance.securityScheduleForm.controls.nightShift.valid).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Hari berikutnya');
    expect(fixture.nativeElement.textContent).toContain('Preview rotasi tiga hari');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await fixture.componentInstance.saveSecuritySchedules();
    expect(saveSecuritySchedules).toHaveBeenCalled();
  });

  it('requires confirmation because saving resets the Satpam rotation to Day 1', async () => {
    fixture.componentInstance.selectTab('security');
    fixture.detectChanges();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

    await fixture.componentInstance.saveSecuritySchedules();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Hari 1 rotasi Satpam'));
    expect(saveSecuritySchedules).not.toHaveBeenCalled();
  });

  it('saves the operational report start date separately from schedules', async () => {
    fixture.componentInstance.reportingForm.controls.operationalStartDate.setValue('2026-10-01');

    await fixture.componentInstance.saveReportingSettings();

    expect(saveReportingSettings).toHaveBeenCalledWith({
      operationalStartDate: '2026-10-01',
    });
  });

  it('focuses the first invalid field within the night checkout segment', async () => {
    fixture.componentInstance.selectTab('security');
    fixture.componentInstance.securityScheduleForm.controls.nightShift.patchValue({
      checkoutOpen: '07:00',
      workEnd: '06:00',
      checkoutClose: '08:00',
    });
    fixture.detectChanges();

    await fixture.componentInstance.saveSecuritySchedules();

    expect(saveSecuritySchedules).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('#nightShift-workEnd'),
    );
  });

  it('blocks an invalid schedule order before calling the API', async () => {
    fixture.componentInstance.selectTab('schedule');
    fixture.detectChanges();
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

  it('saves schedule and a geofence template without activating it', async () => {
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
    fixture.componentInstance.geofenceForm.controls.name.setValue('Zona Belakang');
    await fixture.componentInstance.saveGeofenceTemplate();
    expect(createGeofenceTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Zona Belakang', shape: 'POLYGON', maxAccuracyMeters: 15 }),
    );
    expect(activateGeofenceTemplate).not.toHaveBeenCalled();
  });

  it('requests the current location only after the admin clicks the location button', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({
      coords: { latitude: -7.9826, longitude: 112.6308, accuracy: 9 },
    } as GeolocationPosition));
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition },
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();

    await fixture.componentInstance.checkCurrentGeofenceLocation();

    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    expect(fixture.componentInstance.currentGeofenceLocation()).toEqual({
      latitude: -7.9826,
      longitude: 112.6308,
      accuracyMeters: 9,
    });
    expect(fixture.componentInstance.geofenceVertices()).toEqual([]);
  });

  it('activates a saved template only after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await fixture.componentInstance.activateGeofenceTemplate(template);
    expect(activateGeofenceTemplate).toHaveBeenCalledWith(template.id);
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
