import { Component, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ProfilePhotoCropDialogData {
  file: File;
}

interface CropPosition {
  x: number;
  y: number;
}

const cropSize = 288;
const outputSize = 512;

@Component({
  selector: 'app-profile-photo-crop-dialog',
  imports: [MatDialogModule],
  templateUrl: './profile-photo-crop-dialog.html',
  styleUrl: './profile-photo-crop-dialog.scss',
})
export class ProfilePhotoCropDialog implements OnDestroy {
  @ViewChild('sourceImage') private sourceImage?: ElementRef<HTMLImageElement>;

  readonly data = inject<ProfilePhotoCropDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ProfilePhotoCropDialog, File>>(MatDialogRef);
  readonly objectUrl: string;
  private dragStart: { clientX: number; clientY: number; position: CropPosition } | null = null;
  readonly imageSize = signal<{ width: number; height: number } | null>(null);
  readonly frameSize = signal(cropSize);
  readonly zoom = signal(1);
  readonly position = signal<CropPosition>({ x: 0, y: 0 });
  readonly isReady = computed(() => this.imageSize() !== null);
  readonly renderSize = computed(() => {
    const image = this.imageSize();
    const frameSize = this.frameSize();
    if (!image) return { width: frameSize, height: frameSize };
    const scale = Math.max(frameSize / image.width, frameSize / image.height) * this.zoom();
    return { width: image.width * scale, height: image.height * scale };
  });
  readonly imageStyle = computed(() => {
    const size = this.renderSize();
    const position = this.position();
    return {
      width: `${size.width}px`,
      height: `${size.height}px`,
      transform: `translate(${position.x}px, ${position.y}px)`,
    };
  });

  constructor() {
    this.objectUrl = URL.createObjectURL(this.data.file);
  }

  imageLoaded(event: Event): void {
    const image = event.target as HTMLImageElement;
    this.frameSize.set(image.parentElement?.clientWidth || cropSize);
    this.imageSize.set({ width: image.naturalWidth, height: image.naturalHeight });
    this.position.set(this.centeredPosition());
  }

  zoomChanged(event: Event): void {
    this.zoom.set(Number((event.target as HTMLInputElement).value));
    this.position.update((position) => this.clampPosition(position));
  }

  startDragging(event: PointerEvent): void {
    if (!this.isReady()) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragStart = { clientX: event.clientX, clientY: event.clientY, position: this.position() };
  }

  drag(event: PointerEvent): void {
    if (!this.dragStart) return;
    this.position.set(this.clampPosition({
      x: this.dragStart.position.x + event.clientX - this.dragStart.clientX,
      y: this.dragStart.position.y + event.clientY - this.dragStart.clientY,
    }));
  }

  stopDragging(): void {
    this.dragStart = null;
  }

  confirm(): void {
    const image = this.sourceImage?.nativeElement;
    if (!image || !this.isReady()) return;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) return;
    const scale = outputSize / this.frameSize();
    const size = this.renderSize();
    const position = this.position();
    context.drawImage(image, position.x * scale, position.y * scale, size.width * scale, size.height * scale);
    canvas.toBlob((blob) => {
      if (!blob) return;
      this.dialogRef.close(new File([blob], 'foto-profil.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }

  cancel(): void {
    this.dialogRef.close();
  }

  ngOnDestroy(): void {
    URL.revokeObjectURL(this.objectUrl);
  }

  private centeredPosition(): CropPosition {
    const size = this.renderSize();
    const frameSize = this.frameSize();
    return { x: (frameSize - size.width) / 2, y: (frameSize - size.height) / 2 };
  }

  private clampPosition(position: CropPosition): CropPosition {
    const size = this.renderSize();
    return {
      x: Math.min(0, Math.max(this.frameSize() - size.width, position.x)),
      y: Math.min(0, Math.max(this.frameSize() - size.height, position.y)),
    };
  }
}
