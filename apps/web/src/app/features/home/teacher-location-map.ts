import type { LocationInput } from '@absensi/contracts';
import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  InjectionToken,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import * as Leaflet from 'leaflet';

type LeafletApi = Pick<
  typeof Leaflet,
  'circle' | 'circleMarker' | 'map' | 'tileLayer'
>;

export const LEAFLET = new InjectionToken<LeafletApi>('Leaflet API', {
  providedIn: 'root',
  factory: () => Leaflet,
});

@Component({
  selector: 'app-teacher-location-map',
  styleUrl: './teacher-location-map.scss',
  templateUrl: './teacher-location-map.html',
})
export class TeacherLocationMap
  implements AfterViewInit, OnChanges, OnDestroy
{
  private readonly leaflet = inject(LEAFLET);

  @Input({ required: true }) location!: LocationInput;
  @ViewChild('mapHost', { static: true })
  private mapHost!: ElementRef<HTMLElement>;

  private mapInstance: Leaflet.Map | null = null;
  private locationMarker: Leaflet.CircleMarker | null = null;
  private accuracyCircle: Leaflet.Circle | null = null;

  ngAfterViewInit(): void {
    this.mapInstance = this.leaflet.map(this.mapHost.nativeElement, {
      attributionControl: true,
      keyboard: true,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    this.leaflet
      .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      })
      .addTo(this.mapInstance);
    this.renderLocation();
  }

  ngOnChanges(): void {
    if (this.mapInstance) this.renderLocation();
  }

  ngOnDestroy(): void {
    this.mapInstance?.remove();
    this.mapInstance = null;
    this.locationMarker = null;
    this.accuracyCircle = null;
  }

  private renderLocation(): void {
    if (!this.mapInstance || !this.location) return;

    const coordinates: Leaflet.LatLngExpression = [
      this.location.latitude,
      this.location.longitude,
    ];
    this.mapInstance.setView(coordinates, 18);

    if (this.locationMarker) {
      this.locationMarker.setLatLng(coordinates);
    } else {
      this.locationMarker = this.leaflet
        .circleMarker(coordinates, {
          color: '#ffffff',
          fillColor: '#245ca8',
          fillOpacity: 1,
          opacity: 1,
          radius: 8,
          weight: 3,
        })
        .addTo(this.mapInstance);
    }

    if (this.accuracyCircle) {
      this.accuracyCircle.setLatLng(coordinates);
      this.accuracyCircle.setRadius(this.location.accuracyMeters);
    } else {
      this.accuracyCircle = this.leaflet
        .circle(coordinates, {
          color: '#245ca8',
          fillColor: '#4f86d4',
          fillOpacity: 0.14,
          opacity: 0.72,
          radius: this.location.accuracyMeters,
          weight: 2,
        })
        .addTo(this.mapInstance);
    }

    if (this.location.accuracyMeters > 0) {
      this.mapInstance.fitBounds(this.accuracyCircle.getBounds(), {
        maxZoom: 18,
        padding: [24, 24],
      });
    }
  }
}
