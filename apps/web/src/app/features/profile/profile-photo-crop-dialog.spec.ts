import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfilePhotoCropDialog } from './profile-photo-crop-dialog';

describe('ProfilePhotoCropDialog', () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;

  afterEach(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
    vi.restoreAllMocks();
  });

  it('returns a square JPEG File when the crop is confirmed and closes without a file when canceled', () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:photo') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { file: new File(['image'], 'original.png', { type: 'image/png' }) } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    });
    const dialog = TestBed.runInInjectionContext(() => new ProfilePhotoCropDialog());
    const sourceImage = document.createElement('img');
    (dialog as unknown as { sourceImage: { nativeElement: HTMLImageElement } }).sourceImage = { nativeElement: sourceImage };
    dialog.imageLoaded({ target: { naturalWidth: 800, naturalHeight: 600 } } as unknown as Event);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['crop'], { type: 'image/jpeg' })));

    dialog.confirm();

    expect(close).toHaveBeenCalledWith(expect.any(File));
    const croppedFile = close.mock.calls[0]?.[0] as File;
    expect(croppedFile.name).toBe('foto-profil.jpg');
    expect(croppedFile.type).toBe('image/jpeg');
    dialog.cancel();
    expect(close).toHaveBeenLastCalledWith();
  });
});
