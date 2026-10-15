import { FaceChallengeResponseSchema, type FaceChallengeResponse } from '@absensi/contracts';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CameraSession } from './camera-session';
import { advanceChallenge, evaluateFrame, type ChallengeProgress, type FrameSignals } from './face-challenge-evaluator';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const EMPTY_PROGRESS: ChallengeProgress = { stepIndex: 0, sawOpenEyes: false, sawClosedEyes: false, neutralYaw: null };

@Component({
  selector: 'app-face-challenge-page',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './face-challenge-page.html',
  styleUrl: './face-challenge-page.scss',
})
export class FaceChallengePage {
  @ViewChild('preview') private preview?: ElementRef<HTMLVideoElement>;
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private camera: CameraSession | null = null;
  private landmarker: import('@mediapipe/tasks-vision').FaceLandmarker | null = null;
  private frameHandle: number | null = null;
  private lastFrameAt = 0;
  private runId = 0;
  private destroyed = false;
  private readonly lightCanvas = document.createElement('canvas');

  readonly state = signal<'IDLE' | 'STARTING' | 'ACTIVE' | 'DONE' | 'ERROR'>('IDLE');
  readonly feedback = signal('Tekan Mulai untuk meminta izin kamera.');
  readonly error = signal<string | null>(null);
  readonly challenge = signal<FaceChallengeResponse | null>(null);
  readonly progress = signal<ChallengeProgress>(EMPTY_PROGRESS);
  readonly action = this.route.snapshot.queryParamMap.get('action') === 'CHECKOUT' ? 'CHECKOUT' : 'CHECK_IN';

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.runId += 1;
      this.cleanup();
    });
  }

  async start(): Promise<void> {
    if (this.state() === 'STARTING' || this.state() === 'ACTIVE') return;
    this.cleanup();
    const runId = ++this.runId;
    this.state.set('STARTING');
    this.error.set(null);
    this.feedback.set('Meminta challenge dari server…');
    try {
      const response = await firstValueFrom(this.http.post<unknown>('/api/attendance/face/challenge', { action: this.action }, { withCredentials: true }));
      if (this.destroyed || runId !== this.runId) return;
      const challenge = FaceChallengeResponseSchema.parse(response);
      this.challenge.set(challenge);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser ini tidak mendukung akses kamera.');
      this.camera = new CameraSession(navigator.mediaDevices);
      const camera = this.camera;
      this.feedback.set('Meminta izin kamera…');
      const stream = await camera.start();
      if (!stream || this.destroyed || runId !== this.runId) return;
      const video = this.preview?.nativeElement;
      if (!video) throw new Error('Pratinjau kamera tidak tersedia.');
      video.srcObject = stream;
      await video.play();
      if (this.destroyed || runId !== this.runId) return;
      this.feedback.set('Menyiapkan pendeteksi wajah…');
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/assets/mediapipe');
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 2, outputFaceBlendshapes: true,
      });
      if (this.destroyed || runId !== this.runId) { landmarker.close(); return; }
      this.landmarker = landmarker;
      this.progress.set({ ...EMPTY_PROGRESS });
      this.state.set('ACTIVE');
      this.feedback.set('Posisikan satu wajah di tengah kamera.');
      this.scheduleFrame();
    } catch (cause) {
      if (this.destroyed || runId !== this.runId) return;
      this.cleanup();
      this.state.set('ERROR');
      this.error.set(cause instanceof Error ? cause.message : 'Kamera atau pendeteksi wajah gagal dimuat.');
    }
  }

  stop(): void {
    this.runId += 1;
    this.cleanup();
    this.state.set('IDLE');
    this.challenge.set(null);
    this.feedback.set('Kamera berhenti. Mulai lagi jika diperlukan.');
  }

  stepLabel(step: FaceChallengeResponse['steps'][number]): string {
    return step === 'BLINK' ? 'Kedipkan kedua mata' : step === 'TURN_LEFT' ? 'Toleh ke kiri' : 'Toleh ke kanan';
  }

  private scheduleFrame(): void {
    this.frameHandle = requestAnimationFrame((timestamp) => this.processFrame(timestamp));
  }

  private processFrame(timestamp: number): void {
    if (this.state() !== 'ACTIVE') return;
    if (timestamp - this.lastFrameAt < 120) { this.scheduleFrame(); return; }
    this.lastFrameAt = timestamp;
    const video = this.preview?.nativeElement;
    const challenge = this.challenge();
    if (!video || !challenge || !this.landmarker || video.readyState < 2) { this.scheduleFrame(); return; }
    if (Date.now() > Date.parse(challenge.expiresAt)) {
      this.cleanup();
      this.state.set('ERROR');
      this.error.set('Challenge kedaluwarsa. Mulai lagi untuk meminta urutan baru.');
      return;
    }
    try {
      const result = this.landmarker.detectForVideo(video, timestamp);
      const face = result.faceLandmarks[0];
      const xValues = face?.map((point) => point.x) ?? [];
      const faceWidth = xValues.length ? Math.max(...xValues) - Math.min(...xValues) : 0;
      const faceCenter = xValues.length ? (Math.max(...xValues) + Math.min(...xValues)) / 2 : 0;
      const blendshapes = result.faceBlendshapes[0]?.categories ?? [];
      const score = (name: string) => blendshapes.find((item) => item.categoryName === name)?.score ?? 0;
      const leftCheek = face?.[234]?.x ?? 0;
      const rightCheek = face?.[454]?.x ?? 0;
      const nose = face?.[1]?.x ?? 0;
      const yaw = Math.abs(rightCheek - leftCheek) > 0.01 ? (nose - (leftCheek + rightCheek) / 2) / Math.abs(rightCheek - leftCheek) : 0;
      const signals: FrameSignals = {
        faceCount: result.faceLandmarks.length,
        brightness: this.brightness(video),
        faceWidth,
        centered: Math.abs(faceCenter - 0.5) < 0.18,
        blinkLeft: score('eyeBlinkLeft'),
        blinkRight: score('eyeBlinkRight'),
        yaw,
      };
      const quality = evaluateFrame(signals);
      this.feedback.set(quality.message);
      const step = challenge.steps[this.progress().stepIndex];
      if (step && quality.status === 'READY') {
        const next = advanceChallenge(this.progress(), step, signals);
        this.progress.set(next);
        if (next.stepIndex >= challenge.steps.length) {
          this.cleanup();
          this.state.set('DONE');
          this.feedback.set('Latihan challenge selesai. Absensi belum dicatat.');
          return;
        }
      }
    } catch {
      this.cleanup();
      this.state.set('ERROR');
      this.error.set('Pendeteksi wajah berhenti. Coba mulai ulang.');
      return;
    }
    this.scheduleFrame();
  }

  private brightness(video: HTMLVideoElement): number {
    this.lightCanvas.width = 16;
    this.lightCanvas.height = 12;
    const context = this.lightCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    context.drawImage(video, 0, 0, 16, 12);
    const pixels = context.getImageData(0, 0, 16, 12).data;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) total += (pixels[i]! + pixels[i + 1]! + pixels[i + 2]!) / 3;
    return total / (pixels.length / 4);
  }

  private cleanup(): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.camera?.stop();
    this.camera = null;
    const video = this.preview?.nativeElement;
    if (video) { video.pause(); video.srcObject = null; }
  }
}
