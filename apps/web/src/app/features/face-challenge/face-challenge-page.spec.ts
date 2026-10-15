import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FaceChallengePage } from './face-challenge-page';

describe('FaceChallengePage camera lifecycle', () => {
  const originalDevices = navigator.mediaDevices;
  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalDevices });
  });

  it('keeps the camera preview free of decorative overlays during training', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(FaceChallengePage);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.componentInstance.state.set('ACTIVE');fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('video')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.componentInstance.stop();fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.face-frame')).toBeNull();
    fixture.destroy();TestBed.inject(HttpTestingController).verify();
  });

  it('opens camera only after Guru starts and stops a late stream on navigation', async () => {
    const stop = vi.fn();
    let resolveStream!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    const getUserMedia = vi.fn().mockReturnValue(pending);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ action: 'CHECK_IN' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(FaceChallengePage);
    fixture.detectChanges();
    expect(getUserMedia).not.toHaveBeenCalled();

    const started = fixture.componentInstance.start();
    const http = TestBed.inject(HttpTestingController);
    const challenge = http.expectOne('/api/attendance/face/challenge');
    expect(challenge.request.body).toEqual({ action: 'CHECK_IN' });
    challenge.flush({ challengeId: crypto.randomUUID(), steps: ['BLINK', 'TURN_LEFT'], expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledOnce();

    fixture.destroy();
    resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await started;
    expect(stop).toHaveBeenCalledOnce();
    http.verify();
  });
});
