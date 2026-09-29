import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  LOTTIE_MODULE_LOADER,
  OpeningScreen,
} from './opening-screen';

describe('OpeningScreen', () => {
  it('renders the local Lottie asset and removes the fallback when ready', async () => {
    let domLoaded: (() => void) | undefined;
    const destroy = vi.fn();
    const loadAnimation = vi.fn(() => ({
      addEventListener: vi.fn((event: string, callback: () => void) => {
        if (event === 'DOMLoaded') domLoaded = callback;
        return vi.fn();
      }),
      destroy,
      goToAndStop: vi.fn(),
    }));
    await TestBed.configureTestingModule({
      imports: [OpeningScreen],
      providers: [
        {
          provide: LOTTIE_MODULE_LOADER,
          useValue: async () => ({ default: { loadAnimation } }),
        },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<OpeningScreen> = TestBed.createComponent(OpeningScreen);
    fixture.componentRef.setInput('phase', 'showing');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadAnimation).toHaveBeenCalledWith(expect.objectContaining({
      path: '/assets/animations/cute-mascot-jumping-character.json',
      renderer: 'svg',
      loop: true,
      autoplay: true,
    }));
    expect(fixture.nativeElement.querySelector('[data-fallback-loader]')).not.toBeNull();

    domLoaded?.();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-fallback-loader]')).toBeNull();

    fixture.componentRef.setInput('phase', 'leaving');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.opening-screen')?.classList).toContain('is-leaving');

    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps a simple loader available when Lottie cannot load', async () => {
    await TestBed.configureTestingModule({
      imports: [OpeningScreen],
      providers: [
        {
          provide: LOTTIE_MODULE_LOADER,
          useValue: async () => { throw new Error('renderer unavailable'); },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OpeningScreen);
    fixture.componentRef.setInput('phase', 'showing');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.outerHTML).toContain('data-fallback-loader');
    expect(
      fixture.nativeElement.querySelector('.opening-screen')?.getAttribute('aria-label'),
    ).toBe('Menyiapkan halaman');
  });
});
