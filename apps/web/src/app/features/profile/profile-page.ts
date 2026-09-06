import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { injectMutation, injectQueryClient } from '@tanstack/angular-query-experimental';

import { AuthService } from '../../core/auth/auth.service';
import { queryKeys } from '../../core/query/query-keys';
import { ProfileService } from './profile.service';
import { ProfilePhotoCropDialog } from './profile-photo-crop-dialog';

@Component({
  selector: 'app-profile-page',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, ReactiveFormsModule, RouterLink],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.scss',
})
export class ProfilePage {
  private readonly auth = inject(AuthService);
  private readonly service = inject(ProfileService);
  private readonly dialog = inject(MatDialog);
  private readonly queryClient = injectQueryClient();
  protected readonly user = this.auth.user;
  protected readonly fullName = new FormControl(this.user()?.fullName ?? '', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(200)],
  });
  protected readonly message = signal('');
  protected readonly errorMessage = signal('');
  protected readonly photoUrl = computed(() => `/api/profile/photo?v=${encodeURIComponent(this.user()?.photo?.updatedAt ?? '')}`);

  protected readonly updateName = injectMutation(() => ({
    mutationFn: (name: string) => this.service.updateName(name),
    onMutate: () => this.clearFeedback(),
    onSuccess: (user) => this.accept(user, 'Nama berhasil diperbarui.'),
    onError: () => this.errorMessage.set('Nama tidak dapat diperbarui. Coba lagi.'),
  }));
  protected readonly uploadPhoto = injectMutation(() => ({
    mutationFn: (file: File) => this.service.uploadPhoto(file),
    onMutate: () => this.clearFeedback(),
    onSuccess: (user) => this.accept(user, 'Foto profil berhasil diperbarui.'),
    onError: () => this.errorMessage.set('Foto tidak dapat diunggah. Periksa format dan ukuran file, lalu coba lagi.'),
  }));
  protected readonly deletePhoto = injectMutation(() => ({
    mutationFn: () => this.service.deletePhoto(),
    onMutate: () => this.clearFeedback(),
    onSuccess: (user) => this.accept(user, 'Foto profil berhasil dihapus.'),
    onError: () => this.errorMessage.set('Foto tidak dapat dihapus. Coba lagi.'),
  }));

  protected saveName(event: Event): void {
    event.preventDefault();
    if (this.fullName.invalid) {
      this.fullName.markAsTouched();
      return;
    }
    this.updateName.mutate(this.fullName.value.trim());
  }

  protected selectPhoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    if (!this.isAcceptedPhoto(file)) {
      this.errorMessage.set('Pilih foto JPEG, PNG, atau WebP dengan ukuran maksimal 2 MB.');
      return;
    }
    if (this.user()?.role !== 'USER') {
      this.uploadPhoto.mutate(file);
      return;
    }
    this.dialog.open(ProfilePhotoCropDialog, {
      data: { file },
      width: '420px',
      maxWidth: 'calc(100vw - 32px)',
      autoFocus: false,
    }).afterClosed().subscribe((croppedPhoto) => {
      if (croppedPhoto) this.uploadPhoto.mutate(croppedPhoto);
    });
  }

  protected initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  }

  private clearFeedback(): void {
    this.message.set('');
    this.errorMessage.set('');
  }

  private isAcceptedPhoto(file: File): boolean {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 2 * 1024 * 1024;
  }

  private accept(user: Parameters<AuthService['acceptUser']>[0], message: string): void {
    this.auth.acceptUser(user);
    this.queryClient.setQueryData(queryKeys.profile, user);
    this.errorMessage.set('');
    this.message.set(message);
  }
}
