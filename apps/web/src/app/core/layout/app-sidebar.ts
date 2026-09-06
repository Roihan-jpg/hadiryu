import { A11yModule } from '@angular/cdk/a11y';
import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import type { AuthUser } from '@absensi/contracts';

export interface SidebarNavigationItem {
  path: string;
  label: string;
  exact: boolean;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [A11yModule, RouterLink, RouterLinkActive],
  templateUrl: './app-sidebar.html',
  styleUrl: './app-sidebar.scss',
  encapsulation: ViewEncapsulation.None,
})
export class AppSidebar {
  @Input({ required: true }) user!: AuthUser;
  @Input({ required: true }) navigation: readonly SidebarNavigationItem[] = [];
  @Input() isOpen = false;
  @Input() isCollapsed = false;
  @Output() readonly closeMenu = new EventEmitter<void>();
  @Output() readonly toggleCompact = new EventEmitter<void>();
  @Output() readonly logout = new EventEmitter<void>();

  protected get isAdmin(): boolean { return this.user.role === 'SUPER_ADMIN'; }

  protected photoUrl(updatedAt: string): string {
    return `/api/profile/photo?v=${encodeURIComponent(updatedAt)}`;
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }
}
