import { Component, computed, input, signal } from '@angular/core';
import type { AdminDashboardResponse } from '@absensi/contracts';

@Component({
  selector: 'app-arrival-chart',
  template: `
    @if (data().window; as window) {
      <div class="chart-caption"><span>Jumlah Guru yang sudah check-in</span><span>Waktu Indonesia Barat</span></div>
      <svg viewBox="0 0 760 290" role="group" aria-label="Grafik kumulatif kedatangan Guru">
        @for (tick of ticks(); track tick.value) {
          <line x1="42" x2="724" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
          <text x="30" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.value }}</text>
        }
        <line [attr.x1]="x(window.startAt)" [attr.x2]="x(window.startAt)" y1="36" y2="246" class="start" />
        <text [attr.x]="markerX()" y="20" [attr.text-anchor]="markerAnchor()" class="marker">Mulai kerja {{ time(window.startAt) }}</text>
        @if (path()) { <path [attr.d]="path()" class="arrival-line" /> }
        @for (point of data().arrivals; track point.at) {
          <g tabindex="0" role="button" [attr.aria-label]="detail(point)" (focus)="active.set(point)" (mouseenter)="active.set(point)" (click)="active.set(point)" (keydown.enter)="active.set(point)" (keydown.space)="$event.preventDefault(); active.set(point)">
            <circle [attr.cx]="x(point.at)" [attr.cy]="y(point.cumulative)" r="17" class="hit" />
            <circle [attr.cx]="x(point.at)" [attr.cy]="y(point.cumulative)" r="4" class="point" />
            <title>{{ detail(point) }}</title>
          </g>
        }
        <text x="42" y="277">{{ time(domain().openAt) }}</text>
        <text x="724" y="277" text-anchor="end">{{ time(domain().closeAt) }}</text>
      </svg>
      <p class="readout" aria-live="polite">{{ active() ? detail(active()!) : data().arrivals.length ? 'Pilih titik untuk melihat rincian kedatangan.' : 'Belum ada check-in tercatat pada tanggal ini.' }}</p>
    } @else {
      <div class="chart-empty"><strong>{{ data().day.description }}</strong><p>Grafik ditampilkan ketika jadwal dan data hari kerja tersedia.</p></div>
    }
  `,
  styles: `
    :host { display:block; min-width:0; }
    .chart-caption { display:flex; justify-content:space-between; gap:12px; font-size:12px; color:#65766f; }
    svg { display:block; width:100%; min-height:200px; overflow:visible; margin-top:18px; }
    text { font:12px 'Manrope Variable',sans-serif; fill:#65766f; }
    .grid { stroke:#e8ebe5; stroke-width:1; }
    .start { stroke:#899b94; stroke-dasharray:4 5; }
    .marker { fill:#283e3a; font-weight:700; }
    .arrival-line { fill:none; stroke:#347b71; stroke-width:3; stroke-linejoin:round; }
    .point { fill:#fffdf9; stroke:#347b71; stroke-width:2; }
    .hit { fill:transparent; cursor:pointer; }
    g:focus { outline:none; } g:focus .point { stroke:#283e3a; stroke-width:5; }
    .readout { min-height:36px; font-size:12px; color:#52675f; margin:4px 0 0; }
    .chart-empty { min-height:280px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; color:#52675f; }
    .chart-empty p { font-size:14px; }
    @media(max-width:600px) { .chart-caption span:last-child { display:none; } svg { min-height:170px; } }
  `,
})
export class ArrivalChart {
  readonly data = input.required<AdminDashboardResponse>();
  readonly active = signal<AdminDashboardResponse['arrivals'][number] | null>(null);
  readonly maximum = computed(() => Math.max(1, this.data().day.scheduled ?? 0, ...this.data().arrivals.map((point) => point.cumulative)));
  readonly ticks = computed(() => [...new Set([0, Math.round(this.maximum() / 2), this.maximum()])].map((value) => ({ value, y: this.y(value) })));
  readonly domain = computed(() => {
    const window = this.data().window!;
    const times = this.data().arrivals.map((point) => Date.parse(point.at));
    // A same-day schedule edit must never move an already recorded arrival to the axis edge.
    const first = Math.min(Date.parse(window.openAt), ...times);
    const last = Math.max(first + 60_000, Date.parse(window.closeAt), ...times);
    return { openAt: new Date(first).toISOString(), closeAt: new Date(last).toISOString() };
  });
  x(at: string): number {
    const window = this.domain();
    return 42 + Math.max(0, Math.min(1, (Date.parse(at) - Date.parse(window.openAt)) / Math.max(1, Date.parse(window.closeAt) - Date.parse(window.openAt)))) * 682;
  }
  y(count: number): number { return 246 - count / this.maximum() * 200; }
  markerX(): number { return Math.max(46, Math.min(720, this.x(this.data().window!.startAt))); }
  markerAnchor(): string { const x = this.markerX(); return x < 160 ? 'start' : x > 600 ? 'end' : 'middle'; }
  readonly path = computed(() => {
    const window = this.data().window;
    if (!window || Date.parse(window.observedUntil) < Date.parse(window.openAt)) return '';
    let path = `M 42 ${this.y(0)}`;
    for (const point of this.data().arrivals) path += ` H ${this.x(point.at)} V ${this.y(point.cumulative)}`;
    const last = this.data().arrivals.at(-1)?.at ?? window.observedUntil;
    return `${path} H ${this.x(Date.parse(last) > Date.parse(window.observedUntil) ? last : window.observedUntil)}`;
  });
  time(at: string): string { return new Intl.DateTimeFormat('id-ID', { timeZone:'Asia/Jakarta', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(at)); }
  detail(point: AdminDashboardResponse['arrivals'][number]): string { return `${this.time(point.at)} WIB · ${point.count} Guru datang · ${point.cumulative} Guru sudah check-in`; }
}
