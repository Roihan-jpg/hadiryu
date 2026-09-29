import type { GeofenceCoordinate } from '@absensi/contracts';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import {
  ADMIN_GEOFENCE_LEAFLET,
  AdminGeofenceMap,
} from './admin-geofence-map';

describe('AdminGeofenceMap', () => {
  let fixture: ComponentFixture<AdminGeofenceMap>;
  let map: {
    fitBounds: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    setView: ReturnType<typeof vi.fn>;
  };
  let circle: ReturnType<typeof vi.fn>;
  let clickHandler: ((event: { latlng: { lat: number; lng: number } }) => void) | undefined;

  beforeEach(async () => {
    map = {
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
    circle = vi.fn(() => ({ ...layer }));
    await TestBed.configureTestingModule({
      imports: [AdminGeofenceMap],
      providers: [{
        provide: ADMIN_GEOFENCE_LEAFLET,
        useValue: {
          circle,
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

  it('keeps Leaflet layers contained below the admin sidebar', () => {
    const mapHost = fixture.nativeElement.querySelector('.map-host') as HTMLElement | null;

    expect(mapHost).not.toBeNull();
    expect(getComputedStyle(mapHost!).position).toBe('relative');
    expect(getComputedStyle(mapHost!).zIndex).toBe('0');
    expect(getComputedStyle(mapHost!).isolation).toBe('isolate');
  });

  it('centers the map and shows GPS accuracy without adding a polygon vertex', () => {
    const changes: GeofenceCoordinate[][] = [];
    fixture.componentInstance.verticesChange.subscribe((value) => changes.push(value));

    fixture.componentRef.setInput('currentLocation', {
      latitude: -7.9826,
      longitude: 112.6308,
      accuracyMeters: 12,
    });
    fixture.detectChanges();

    expect(map.setView).toHaveBeenLastCalledWith([-7.9826, 112.6308], 19);
    expect(circle).toHaveBeenCalledWith([-7.9826, 112.6308], expect.objectContaining({ radius: 12 }));
    expect(changes).toEqual([]);
  });
});
