import type { AuthUser } from '@absensi/contracts';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { provideAngularQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { ProfilePage } from './profile-page';
import { ProfileService } from './profile.service';

const teacher: AuthUser = {
  id: 'de3eb0e2-b31e-4ec5-a932-05297d928368',
  nip: '001234567890',
  fullName: 'Guru Contoh',
  whatsappNumber: '+628123456789',
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

describe('ProfilePage', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let authUser: ReturnType<typeof signal<AuthUser>>;
  const acceptUser = vi.fn();
  const logout = vi.fn();
  const updateProfile = vi.fn();
  const uploadPhoto = vi.fn();
  const deletePhoto = vi.fn();
  const openCropDialog = vi.fn();

  beforeEach(async () => {
    authUser = signal(teacher);
    updateProfile.mockReset();
    uploadPhoto.mockReset();
    deletePhoto.mockReset();
    openCropDialog.mockReset();
    acceptUser.mockReset();
    logout.mockReset();

    TestBed.overrideComponent(ProfilePage, {
      add: { providers: [{ provide: MatDialog, useValue: { open: openCropDialog } }] },
    });
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
        { provide: AuthService, useValue: { user: authUser.asReadonly(), acceptUser, logout } },
        { provide: ProfileService, useValue: { updateProfile, uploadPhoto, deletePhoto } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
  });

  it('shows a clear error when a profile update fails', async () => {
    updateProfile.mockRejectedValue(new Error('network'));
    const input = fixture.nativeElement.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    input.value = 'Nama Baru';
    input.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Profil tidak dapat diperbarui. Coba lagi.');
    });
  });

  it('keeps account metadata and password action visible', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('001234567890');
    expect(text).toContain('Status akun');
    expect(text).toContain('Ganti password');
  });

  it('shows an icon-labeled logout action for Teachers and Super Admins', () => {
    const logoutButton = fixture.nativeElement.querySelector('[data-testid="profile-logout"]') as HTMLButtonElement | null;

    expect(logoutButton?.textContent).toContain('Keluar dari akun');
    expect(logoutButton?.querySelector('svg')).not.toBeNull();

    authUser.set({ ...teacher, role: 'SUPER_ADMIN' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="profile-logout"]')).not.toBeNull();
  });

  it('shows the current WhatsApp number in an editable field', () => {
    const input = fixture.nativeElement.querySelector('input[autocomplete="tel"]') as HTMLInputElement | null;

    expect(input).not.toBeNull();
    expect(input?.value).toBe('+628123456789');
  });

  it('saves the normalized WhatsApp number with the full name', async () => {
    updateProfile.mockResolvedValue({ ...teacher, whatsappNumber: '+628123456789' });
    const nameInput = fixture.nativeElement.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    const whatsappInput = fixture.nativeElement.querySelector('input[autocomplete="tel"]') as HTMLInputElement;
    nameInput.value = 'Nama Baru';
    nameInput.dispatchEvent(new Event('input'));
    whatsappInput.value = ' +628123456789 ';
    whatsappInput.dispatchEvent(new Event('input'));

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    await vi.waitFor(() => expect(updateProfile).toHaveBeenCalledWith({
      fullName: 'Nama Baru',
      whatsappNumber: '+628123456789',
    }));
  });

  it('crops a Teacher photo before sending the resulting File to the upload mutation', async () => {
    const selected = new File(['original'], 'original.png', { type: 'image/png' });
    const cropped = new File(['cropped'], 'profile.jpg', { type: 'image/jpeg' });
    openCropDialog.mockReturnValue({ afterClosed: () => of(cropped) });
    uploadPhoto.mockResolvedValue(teacher);
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [selected] });

    input.dispatchEvent(new Event('change'));

    expect(openCropDialog).toHaveBeenCalledTimes(1);
    expect(uploadPhoto).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(cropped));
  });

  it('crops a Super Admin photo before sending the resulting File to the upload mutation', async () => {
    const admin: AuthUser = { ...teacher, role: 'SUPER_ADMIN' };
    authUser.set(admin);
    fixture.detectChanges();
    const selected = new File(['original'], 'original.png', { type: 'image/png' });
    const cropped = new File(['cropped'], 'profile.jpg', { type: 'image/jpeg' });
    openCropDialog.mockReturnValue({ afterClosed: () => of(cropped) });
    uploadPhoto.mockResolvedValue(admin);
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [selected] });

    input.dispatchEvent(new Event('change'));

    expect(openCropDialog).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(uploadPhoto).toHaveBeenCalledWith(cropped));
  });

  it('does not upload a Teacher photo when the crop dialog is canceled', () => {
    const selected = new File(['original'], 'original.png', { type: 'image/png' });
    openCropDialog.mockReturnValue({ afterClosed: () => of(undefined) });
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [selected] });

    input.dispatchEvent(new Event('change'));

    expect(openCropDialog).toHaveBeenCalledTimes(1);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it('keeps the upload error readable after a cropped Teacher photo fails to upload', async () => {
    const selected = new File(['original'], 'original.png', { type: 'image/png' });
    const cropped = new File(['cropped'], 'profile.jpg', { type: 'image/jpeg' });
    openCropDialog.mockReturnValue({ afterClosed: () => of(cropped) });
    uploadPhoto.mockRejectedValue(new Error('network'));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [selected] });

    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Foto tidak dapat diunggah. Periksa format dan ukuran file, lalu coba lagi.');
    });
  });
});
