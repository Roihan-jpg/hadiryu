import { TestBed } from '@angular/core/testing';
import type { AdminDashboardResponse } from '@absensi/contracts';
import { ArrivalChart } from './arrival-chart';

const data: AdminDashboardResponse = {
  workDate: '2026-09-04',
  generatedAt: '2026-09-04T01:00:00Z',
  day: {
    workDate: '2026-09-04',
    state: 'WORKING',
    description: 'Hari kerja',
    provisional: true,
    scheduled: 10,
    arrived: 2,
    late: 0,
    leave: 0,
    notCheckedIn: 8,
  },
  window: {
    openAt: '2026-09-03T23:00:00Z',
    startAt: '2026-09-04T00:00:00Z',
    closeAt: '2026-09-04T02:00:00Z',
    observedUntil: '2026-09-04T01:00:00Z',
  },
  arrivals: [{ at: '2026-09-03T23:30:00Z', count: 2, cumulative: 2 }],
  trend: [],
  guards: [],
  rosterAvailable: false,
};

describe('ArrivalChart', () => {
  afterEach(() => TestBed.resetTestingModule());
  function setup(value = data) {
    const fixture = TestBed.createComponent(ArrivalChart);
    fixture.componentRef.setInput('data', value);
    fixture.detectChanges();
    return fixture;
  }

  it('draws steps only through server observation time, with accessible point details', () => {
    const fixture = setup();
    const component = fixture.componentInstance;
    expect(component.path()).toContain(' H ');
    expect(component.path()).not.toMatch(/[CQ]/);
    expect(component.path()).toMatch(new RegExp(` H ${component.x(data.window!.observedUntil)}$`));
    const point: SVGGElement = fixture.nativeElement.querySelector('g');
    point.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.readout').textContent).toContain(
      '06.30 WIB · 2 Guru datang · 2 Guru sudah check-in',
    );
  });

  it('keeps labels and coordinates within a narrow chart without shrinking the viewBox text', () => {
    const fixture = setup();
    fixture.componentInstance.width.set(300);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg').getAttribute('viewBox')).toBe('0 0 300 290');
    expect(fixture.componentInstance.x(data.window!.closeAt)).toBe(264);
  });

  it('preserves actual arrivals outside a subsequently edited schedule window', () => {
    const fixture = setup({ ...data, window: { ...data.window!, openAt: '2026-09-04T00:00:00Z' } });
    expect(fixture.componentInstance.domain().openAt).toBe('2026-09-03T23:30:00.000Z');
    expect(fixture.componentInstance.x('2026-09-04T00:00:00Z')).toBeGreaterThan(42);
  });

  it('still draws recorded arrivals when the new opening time is later than server now', () => {
    const fixture = setup({ ...data, window: { ...data.window!, openAt: '2026-09-04T01:30:00Z', startAt: '2026-09-04T01:45:00Z' } });
    expect(fixture.componentInstance.path()).toContain(' V ');
  });

  it('leaves the chart blank before opening and explains unavailable days', () => {
    const fixture = setup({
      ...data,
      arrivals: [],
      window: { ...data.window!, observedUntil: '2026-09-03T22:00:00Z' },
    });
    expect(fixture.componentInstance.path()).toBe('');
    fixture.componentRef.setInput('data', {
      ...data,
      window: null,
      day: { ...data.day, state: 'UNCONFIGURED', description: 'Jadwal belum tersedia' },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('svg')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Jadwal belum tersedia');
  });
});
