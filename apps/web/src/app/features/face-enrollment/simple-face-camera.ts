import { Component, DestroyRef, ElementRef, ViewChild, inject, input, signal, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CameraSession } from '../face-challenge/camera-session';
import { captureFaceFrame } from './capture-frame';
export class FaceCameraError extends Error {}

@Component({
  selector:'app-simple-face-camera', imports:[MatButtonModule],
  template:`@if(active()) { <section class="camera-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-title" (keydown.escape)="cancel()">
    <div class="camera-content"><h2 id="camera-title">Hadapkan wajah ke kamera</h2>
      <p>Tidak perlu berkedip atau menoleh.</p>
      <video #preview autoplay playsinline muted tabindex="0" aria-label="Pratinjau kamera"></video>
      <p role="status">{{ captured() ? 'Memeriksa wajah…' : 'Menyiapkan kamera…' }}</p>
      <p role="status">{{ locationReady() ? 'Lokasi siap' : 'Memeriksa lokasi…' }}</p>
      <button mat-button type="button" (click)="cancel()">Batalkan</button>
    </div></section> }`,
  styles:[`.camera-dialog{position:fixed;inset:0;z-index:1000;background:#0008;display:grid;place-items:center;padding:16px}
    .camera-content{background:white;border-radius:8px;padding:20px;width:min(100%,440px);max-height:95dvh;overflow:auto}
    video{display:block;width:100%;max-height:45dvh;object-fit:contain;transform:scaleX(-1);background:#222}`],
})
export class SimpleFaceCamera {
  @ViewChild('preview') private preview?:ElementRef<HTMLVideoElement>;
  readonly active=signal(false);
  readonly captured=signal(false);
  readonly locationReady=input(false);
  readonly cancelled=output<void>();
  private camera:CameraSession|null=null;
  private run=0;
  private cancelPending:(()=>void)|null=null;
  constructor(){inject(DestroyRef).onDestroy(()=>this.cancel());}
  async capture(){
    this.close();const run=++this.run;this.active.set(true);this.captured.set(false);
    if(!navigator.mediaDevices?.getUserMedia)throw new FaceCameraError('Kamera memerlukan HTTPS dan izin browser.');
    this.camera=new CameraSession(navigator.mediaDevices);
    const work=async()=>{
      const stream=await this.camera!.start();
      await new Promise(resolve=>setTimeout(resolve,0));
      if(run!==this.run||!stream)throw new Error('Pemeriksaan dibatalkan.');
      const video=this.preview?.nativeElement;if(!video)throw new Error('Pratinjau kamera belum tersedia.');
      video.srcObject=stream;await video.play();video.focus();
      await new Promise(resolve=>setTimeout(resolve,700));
      if(run!==this.run)throw new Error('Pemeriksaan dibatalkan.');
      const frame=captureFaceFrame(video);this.captured.set(true);return frame;
    };
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try {
      return await Promise.race([work(),new Promise<never>((_resolve,reject)=>{
        this.cancelPending=()=>reject(new FaceCameraError('Pemeriksaan dibatalkan.'));
        deadline=setTimeout(()=>{this.close();reject(new FaceCameraError('Kamera belum siap. Periksa izin kamera dan coba kembali.'));},15_000);
      })]);
    }catch(error){throw error instanceof FaceCameraError?error:new FaceCameraError(error instanceof Error?error.message:'Kamera belum tersedia.');}
    finally{clearTimeout(deadline);this.cancelPending=null;}
  }
  cancel(){this.cancelPending?.();this.close();this.cancelled.emit();}
  close(){
    this.run++;this.camera?.stop();this.camera=null;this.cancelPending=null;
    const video=this.preview?.nativeElement;if(video){video.pause();video.srcObject=null;}
    this.active.set(false);
  }
}
