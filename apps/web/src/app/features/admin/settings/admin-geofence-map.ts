import type { GeofenceCoordinate } from '@absensi/contracts';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  InjectionToken,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import * as Leaflet from 'leaflet';

type AdminLeafletApi = Pick<
  typeof Leaflet,
  'circleMarker' | 'map' | 'polygon' | 'tileLayer'
>;

export const ADMIN_GEOFENCE_LEAFLET = new InjectionToken<AdminLeafletApi>(
  'Admin geofence Leaflet API',
  { providedIn: 'root', factory: () => Leaflet },
);

@Component({
  selector: 'app-admin-geofence-map',
  template: `
    <div
      #mapHost
      class="map-host"
      role="application"
      aria-label="Peta editor zona absensi. Ketuk peta untuk menambahkan titik batas."
    ></div>
  `,
  styles: `
    :host { display: block; }
    .map-host {
      position: relative;
      z-index: 0;
      isolation: isolate;
      min-height: 28rem;
      overflow: hidden;
      border: 1px solid #aebbd0;
      border-radius: .75rem;
      background: #e9eef5;
    }
    @media (max-width: 680px) { .map-host { min-height: 22rem; } }
  `,
})
export class AdminGeofenceMap implements AfterViewInit, OnChanges, OnDestroy {
  private readonly leaflet = inject(ADMIN_GEOFENCE_LEAFLET);

  @Input({ required: true }) vertices: readonly GeofenceCoordinate[] = [];
  @Input() initialCenter: GeofenceCoordinate = {
    latitude: -8.1328,
    longitude: 113.2219,
  };
  @Output() readonly verticesChange = new EventEmitter<GeofenceCoordinate[]>();
  @ViewChild('mapHost', { static: true }) private mapHost!: ElementRef<HTMLElement>;

  private mapInstance: Leaflet.Map | null = null;
  private polygonLayer: Leaflet.Polygon | null = null;
  private markerLayers: Leaflet.CircleMarker[] = [];

  ngAfterViewInit(): void {
    this.mapInstance = this.leaflet.map(this.mapHost.nativeElement, {
      attributionControl: true,
      keyboard: true,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    this.leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.mapInstance);
    this.mapInstance.setView(
      [this.initialCenter.latitude, this.initialCenter.longitude],
      19,
    );
    this.mapInstance.on('click', this.addVertex);
    this.renderVertices();
  }

  ngOnChanges(): void {
    if (this.mapInstance) this.renderVertices();
  }

  ngOnDestroy(): void {
    this.mapInstance?.off('click', this.addVertex);
    this.mapInstance?.remove();
    this.mapInstance = null;
    this.polygonLayer = null;
    this.markerLayers = [];
  }

  private readonly addVertex = (event: Leaflet.LeafletMouseEvent) => {
    if (this.vertices.length >= 32) return;
    this.verticesChange.emit([
      ...this.vertices,
      { latitude: event.latlng.lat, longitude: event.latlng.lng },
    ]);
  };

  private renderVertices(): void {
    if (!this.mapInstance) return;
    this.polygonLayer?.remove();
    this.polygonLayer = null;
    this.markerLayers.forEach((marker) => marker.remove());
    this.markerLayers = [];

    const positions = this.vertices.map((vertex) => [
      vertex.latitude,
      vertex.longitude,
    ] as Leaflet.LatLngTuple);
    this.markerLayers = positions.map((position) => this.leaflet
      .circleMarker(position, {
        color: '#ffffff',
        fillColor: '#245ca8',
        fillOpacity: 1,
        radius: 6,
        weight: 2,
      })
      .addTo(this.mapInstance!));
    if (positions.length >= 3) {
      this.polygonLayer = this.leaflet.polygon(positions, {
        color: '#245ca8',
        fillColor: '#4f86d4',
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(this.mapInstance);
      this.mapInstance.fitBounds(this.polygonLayer.getBounds(), {
        maxZoom: 19,
        padding: [24, 24],
      });
    }
  }
}
