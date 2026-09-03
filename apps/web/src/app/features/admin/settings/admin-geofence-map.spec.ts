import type { GeofenceCoordinate } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import {
  ADMIN_GEOFENCE_LEAFLET,
  AdminGeofenceMap,
} from './admin-geofence-map';

describe('AdminGeofenceMap', () => {
  let fixture: ComponentFixture<AdminGeofenceMap>;
  let clickHandler: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;

  beforeEach(async () => {
    const map = {
      fitBounds: vi.fn(),
      off: vi.fn(),
      on: vi.fn((event: string, handler: typeof clickHandler) => {
        if (event === 'click') clickHandler = handler;
      }),
      remove: vi.fn(),
      setView: vi.fn(),
    };
    const layer = {
      addTo: vi.fn(() => layer),
      getBounds: vi.fn(() => 'polygon-bounds'),
      remove: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [AdminGeofenceMap],
      providers: [{
        provide: ADMIN_GEOFENCE_LEAFLET,
        useValue: {
          circleMarker: vi.fn(() => ({ ...layer })),
          map: vi.fn(() => map),
          polygon: vi.fn(() => ({ ...layer })),
          tileLayer: vi.fn(() => ({ ...layer })),
        },
      }],
    }).compileComponents();
    fixture = TestBed.createComponent(AdminGeofenceMap);
    fixture.componentRef.setInput('vertices', []);
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('adds a surveyed vertex when the admin taps the map', () => {
    const changes: GeofenceCoordinate[][] = [];
    fixture.componentInstance.verticesChange.subscribe((value) => changes.push(value));

    clickHandler?.({ latlng: { lat: -8.1328, lng: 113.2219 } });

    expect(changes).toEqual([[
      { latitude: -8.1328, longitude: 113.2219 },
    ]]);
  });
});
