import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  imports: [MatButtonModule],
  selector: 'app-home-page',
  styleUrl: './home-page.scss',
  templateUrl: './home-page.html',
})
export class HomePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly roleLabel = computed(() =>
    this.user()?.role === 'SUPER_ADMIN' ? 'SuperAdmin' : 'Guru',
  );

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
