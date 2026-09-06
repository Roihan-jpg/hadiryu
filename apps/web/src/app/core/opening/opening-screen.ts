import type { AnimationItem } from 'lottie-web';
import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  InjectionToken,
  input,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';

import type { OpeningPhase } from './opening-transition.service';

type LottieModule = typeof import('lottie-web');

export const LOTTIE_MODULE_LOADER = new InjectionToken<() => Promise<LottieModule>>(
  'LOTTIE_MODULE_LOADER',
  { factory: () => () => import('lottie-web') },
);

@Component({
  selector: 'app-opening-screen',
  styleUrl: './opening-screen.scss',
  templateUrl: './opening-screen.html',
})
export class OpeningScreen implements AfterViewInit, OnDestroy {
  @ViewChild('animationHost', { static: true })
  private animationHost!: ElementRef<HTMLElement>;

  private readonly loadLottie = inject(LOTTIE_MODULE_LOADER);
  private readonly zone = inject(NgZone);
  private animation: AnimationItem | null = null;
  private removeListeners: Array<() => void> = [];
  private destroyed = false;

  readonly phase = input.required<OpeningPhase>();
  readonly animationReady = signal(false);

  ngAfterViewInit(): void {
    void this.renderAnimation();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.removeListeners.forEach((remove) => remove());
    this.animation?.destroy();
  }

  private async renderAnimation(): Promise<void> {
    try {
      const lottie = (await this.loadLottie()).default;
      if (this.destroyed) return;

      const reduceMotion = globalThis.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches ?? false;
      this.animation = lottie.loadAnimation({
        container: this.animationHost.nativeElement,
        renderer: 'svg',
        loop: !reduceMotion,
        autoplay: !reduceMotion,
        path: '/assets/animations/cute-mascot-jumping-character.json',
        rendererSettings: {
          preserveAspectRatio: 'xMidYMid meet',
          progressiveLoad: true,
        },
      });
      this.removeListeners = [
        this.animation.addEventListener('DOMLoaded', () => {
          if (reduceMotion) this.animation?.goToAndStop(0, true);
          this.zone.run(() => this.setAnimationReady());
        }),
        this.animation.addEventListener('data_failed', () => {
          this.zone.run(() => this.setAnimationReady(false));
        }),
        this.animation.addEventListener('error', () => {
          this.zone.run(() => this.setAnimationReady(false));
        }),
      ];
    } catch {
      this.setAnimationReady(false);
    }
  }

  private setAnimationReady(ready = true): void {
    this.animationReady.set(ready);
  }
}
