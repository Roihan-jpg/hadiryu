import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { ProfileService } from './profile.service';

@Component({
  selector: 'app-profile-page',
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, RouterLink],
  template: `
    <section class="profile-page">
      <header><p>AKUN</p><h1>Profil Saya</h1><span>Kelola nama dan foto profil Anda.</span></header>
      @if (user(); as currentUser) {
        <mat-card appearance="outlined">
          <div class="photo-row">
            <div class="profile-avatar">
              @if (currentUser.photo) {
                <img [src]="photoUrl()" alt="Foto profil {{ currentUser.fullName }}">
              } @else { <span aria-hidden="true">{{ initials(currentUser.fullName) }}</span> }
            </div>
            <div class="photo-actions">
              <strong>Foto profil</strong><small>JPEG, PNG, atau WebP. Maksimal 2 MB.</small>
              <div>
                <label class="upload-button">{{ currentUser.photo ? 'Ganti foto' : 'Tambah foto' }}
                  <input type="file" accept="image/jpeg,image/png,image/webp" (change)="selectPhoto($event)">
                </label>
                @if (currentUser.photo) {
                  <button mat-button type="button" [disabled]="deletePhoto.isPending()" (click)="deletePhoto.mutate()">Hapus foto</button>
                }
              </div>
            </div>
          </div>
          <form (submit)="saveName($event)">
            <mat-form-field appearance="outline"><mat-label>Nama lengkap</mat-label>
              <input matInput [formControl]="fullName" autocomplete="name">
              @if (fullName.invalid) { <mat-error>Nama wajib diisi, maksimal 200 karakter.</mat-error> }
            </mat-form-field>
            <div class="readonly-grid">
              <div><span>NIP</span><strong>{{ currentUser.nip }}</strong></div>
              <div><span>Role</span><strong>{{ currentUser.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Guru' }}</strong></div>
              <div><span>Status akun</span><strong>{{ currentUser.isActive ? 'Aktif' : 'Nonaktif' }}</strong></div>
            </div>
            @if (message()) { <p class="message" role="status">{{ message() }}</p> }
            <div class="form-actions">
              <a mat-button routerLink="/change-password">Ganti password</a>
              <button mat-flat-button type="submit" [disabled]="fullName.invalid || updateName.isPending()">Simpan nama</button>
            </div>
          </form>
        </mat-card>
      }
    </section>
  `,
  styles: [`
    :host{display:block}.profile-page{max-width:760px;margin:0 auto;padding:40px 28px 64px}.profile-page>header{margin-bottom:20px}.profile-page header p{margin:0 0 7px;color:#477f79;font-size:11px;font-weight:800;letter-spacing:.16em}.profile-page h1{margin:0;color:#34413e;font:700 28px/1.2 Manrope,sans-serif}.profile-page header span{display:block;margin-top:7px;color:#74817d;font-size:13px}mat-card{padding:26px;background:#fffdf9;border-color:#e8e0d6;border-radius:8px}.photo-row{display:flex;align-items:center;gap:18px;padding-bottom:24px;border-bottom:1px solid #e8e0d6}.profile-avatar{display:grid;width:88px;height:88px;flex:0 0 88px;place-items:center;overflow:hidden;color:#fff;background:#477f79;border-radius:50%;font-size:24px;font-weight:700}.profile-avatar img{width:100%;height:100%;object-fit:cover}.photo-actions{display:grid;gap:5px}.photo-actions small{color:#74817d}.photo-actions>div{display:flex;align-items:center;gap:8px;margin-top:8px}.upload-button{display:inline-flex;min-height:36px;align-items:center;padding:0 16px;color:#fff;background:#477f79;border-radius:4px;font-size:13px;font-weight:700;cursor:pointer}.upload-button input{position:absolute;width:1px;height:1px;opacity:0}form{display:grid;gap:18px;padding-top:24px}.readonly-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.readonly-grid>div{display:grid;gap:4px;padding:12px;background:#f4eee6;border-radius:5px}.readonly-grid span{color:#74817d;font-size:11px}.readonly-grid strong{font-size:13px}.form-actions{display:flex;justify-content:space-between;align-items:center}.message{margin:0;color:#477f79;font-size:13px}@media(max-width:600px){.profile-page{padding:24px 16px}.photo-row{align-items:flex-start}.readonly-grid{grid-template-columns:1fr}.form-actions{align-items:stretch;flex-direction:column-reverse}}
  `],
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly service = inject(ProfileService);
  private readonly queryClient = injectQueryClient();
  protected readonly user = this.auth.user;
  protected readonly fullName = new FormControl(this.user()?.fullName ?? '', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] });
  protected readonly message = signal('');
  protected readonly photoUrl = computed(() => `/api/profile/photo?v=${encodeURIComponent(this.user()?.photo?.updatedAt ?? '')}`);

  protected readonly updateName = injectMutation(() => ({
    mutationFn: (name: string) => this.service.updateName(name),
    onSuccess: (user) => this.accept(user, 'Nama berhasil diperbarui.'),
  }));
  protected readonly uploadPhoto = injectMutation(() => ({
    mutationFn: (file: File) => this.service.uploadPhoto(file),
    onSuccess: (user) => this.accept(user, 'Foto profil berhasil diperbarui.'),
  }));
  protected readonly deletePhoto = injectMutation(() => ({
    mutationFn: () => this.service.deletePhoto(),
    onSuccess: (user) => this.accept(user, 'Foto profil berhasil dihapus.'),
  }));

  protected saveName(event: Event): void {
    event.preventDefault();
    if (this.fullName.valid) this.updateName.mutate(this.fullName.value.trim());
  }

  protected selectPhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadPhoto.mutate(file);
    input.value = '';
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  private accept(user: Parameters<AuthService['acceptUser']>[0], message: string): void {
    this.auth.acceptUser(user);
    this.queryClient.setQueryData(queryKeys.profile, user);
    this.message.set(message);
  }
}
