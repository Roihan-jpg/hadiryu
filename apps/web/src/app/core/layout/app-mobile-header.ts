import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AuthUser } from '@absensi/contracts';

@Component({
  selector: 'app-mobile-header',
  imports: [RouterLink],
  templateUrl: './app-mobile-header.html',
  styleUrl: './app-mobile-header.scss',
  encapsulation: ViewEncapsulation.None,
})
export class AppMobileHeader {
  @Input({ required: true }) menuLabel!: string;
  @Input({ required: true }) brandHomePath!: string;
  @Input({ required: true }) user!: AuthUser;
  @Input() isOpen = false;
  @Output() readonly openMenu = new EventEmitter<void>();

  protected photoUrl(updatedAt: string): string {
    return `/api/profile/photo?v=${encodeURIComponent(updatedAt)}`;
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }
}
