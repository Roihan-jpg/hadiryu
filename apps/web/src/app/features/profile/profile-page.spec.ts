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
  role: 'USER',
  isActive: true,
  mustChangePassword: false,
};

describe('ProfilePage', () => {
  let fixture: ComponentFixture<ProfilePage>;
  const acceptUser = vi.fn();
  const updateName = vi.fn();
  const uploadPhoto = vi.fn();
  const deletePhoto = vi.fn();
  const openCropDialog = vi.fn();

  beforeEach(async () => {
    updateName.mockReset();
    uploadPhoto.mockReset();
    deletePhoto.mockReset();
    openCropDialog.mockReset();
    acceptUser.mockReset();

    TestBed.overrideComponent(ProfilePage, {
      add: { providers: [{ provide: MatDialog, useValue: { open: openCropDialog } }] },
    });
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        provideAngularQuery(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })),
        { provide: AuthService, useValue: { user: signal(teacher).asReadonly(), acceptUser } },
        { provide: ProfileService, useValue: { updateName, uploadPhoto, deletePhoto } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
  });

  it('shows a clear error when a profile update fails', async () => {
    updateName.mockRejectedValue(new Error('network'));
    const input = fixture.nativeElement.querySelector('input[autocomplete="name"]') as HTMLInputElement;
    input.value = 'Nama Baru';
    input.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Nama tidak dapat diperbarui. Coba lagi.');
    });
  });

  it('keeps account metadata and password action visible', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('001234567890');
    expect(text).toContain('Status akun');
    expect(text).toContain('Ganti password');
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
