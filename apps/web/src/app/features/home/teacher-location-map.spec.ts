import type { LocationInput } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { LEAFLET, TeacherLocationMap } from './teacher-location-map';

const location: LocationInput = {
  latitude: -6.2,
  longitude: 106.816666,
  accuracyMeters: 24.6,
};

describe('TeacherLocationMap', () => {
  let fixture: ComponentFixture<TeacherLocationMap>;
  let setView: ReturnType<typeof vi.fn>;
  let fitBounds: ReturnType<typeof vi.fn>;
  let remove: ReturnType<typeof vi.fn>;
  let circleMarkerSetLatLng: ReturnType<typeof vi.fn>;
  let accuracySetLatLng: ReturnType<typeof vi.fn>;
  let accuracySetRadius: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setView = vi.fn();
    fitBounds = vi.fn();
    remove = vi.fn();
    circleMarkerSetLatLng = vi.fn();
    accuracySetLatLng = vi.fn();
    accuracySetRadius = vi.fn();

    const map = {
      fitBounds,
      remove,
      setView,
    };
    const tileLayer = { addTo: vi.fn(() => tileLayer) };
    const circleMarker = {
      addTo: vi.fn(() => circleMarker),
      setLatLng: circleMarkerSetLatLng,
    };
    const accuracyCircle = {
      addTo: vi.fn(() => accuracyCircle),
      getBounds: vi.fn(() => 'accuracy-bounds'),
      setLatLng: accuracySetLatLng,
      setRadius: accuracySetRadius,
    };
    const leaflet = {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => tileLayer),
      circleMarker: vi.fn(() => circleMarker),
      circle: vi.fn(() => accuracyCircle),
    };

    await TestBed.configureTestingModule({
      imports: [TeacherLocationMap],
      providers: [{ provide: LEAFLET, useValue: leaflet }],
    }).compileComponents();

    fixture = TestBed.createComponent(TeacherLocationMap);
    fixture.componentRef.setInput('location', location);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders an attributed map with a point and accuracy circle', () => {
    const leaflet = TestBed.inject(LEAFLET);

    expect(leaflet.tileLayer).toHaveBeenCalledWith(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      expect.objectContaining({
        attribution: expect.stringContaining('OpenStreetMap'),
        maxZoom: 19,
      }),
    );
    expect(leaflet.circleMarker).toHaveBeenCalledWith(
      [-6.2, 106.816666],
      expect.any(Object),
    );
    expect(leaflet.circle).toHaveBeenCalledWith(
      [-6.2, 106.816666],
      expect.objectContaining({ radius: 24.6 }),
    );
    expect(fitBounds).toHaveBeenCalledWith('accuracy-bounds', {
      maxZoom: 18,
      padding: [24, 24],
    });
  });

  it('updates existing layers when the location input changes', () => {
    fixture.componentRef.setInput('location', {
      latitude: -6.21,
      longitude: 106.82,
      accuracyMeters: 12,
    } satisfies LocationInput);
    fixture.detectChanges();

    expect(circleMarkerSetLatLng).toHaveBeenCalledWith([-6.21, 106.82]);
    expect(accuracySetLatLng).toHaveBeenCalledWith([-6.21, 106.82]);
    expect(accuracySetRadius).toHaveBeenCalledWith(12);
    expect(fitBounds).toHaveBeenCalledTimes(2);
  });

  it('removes the Leaflet instance when the component is destroyed', () => {
    fixture.destroy();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
