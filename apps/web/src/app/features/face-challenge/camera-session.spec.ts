import { describe, expect, it, vi } from 'vitest';
import { CameraSession } from './camera-session';

describe('CameraSession', () => {
  it.each([true, false])('opens the camera when automatic exposure support is %s', async (supported) => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const track = { stop: vi.fn(), getCapabilities: () => ({ exposureMode: supported ? ['continuous', 'manual'] : ['manual'] }), applyConstraints };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const camera = new CameraSession({ getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices);
    await expect(camera.start()).resolves.toBe(stream);
    if (supported) expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ exposureMode: 'continuous' }] });
    else expect(applyConstraints).not.toHaveBeenCalled();
  });

  it('keeps the camera usable when the device rejects automatic exposure', async () => {
    const track = { stop: vi.fn(), getCapabilities: () => ({ exposureMode: ['continuous'] }), applyConstraints: vi.fn().mockRejectedValue(new DOMException('', 'OverconstrainedError')) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const camera = new CameraSession({ getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices);
    await expect(camera.start()).resolves.toBe(stream);
  });

  it('releases the camera during a pending exposure adjustment', async () => {
    let finish!: () => void;
    const exposure = new Promise<void>((resolve) => { finish = resolve; });
    const track = { stop: vi.fn(), getCapabilities: () => ({ exposureMode: ['continuous'] }), applyConstraints: vi.fn().mockReturnValue(exposure) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const camera = new CameraSession({ getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices);
    const started = camera.start();
    await Promise.resolve();
    camera.stop();
    finish();
    await expect(started).resolves.toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it.each([
    ['NotAllowedError', 'Akses kamera ditolak. Izinkan kamera lalu coba lagi.'],
    ['NotReadableError', 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.'],
  ])('maps %s to actionable feedback', async (name, message) => {
    const devices = { getUserMedia: vi.fn().mockRejectedValue(new DOMException('', name)) } as unknown as MediaDevices;
    const camera = new CameraSession(devices);
    await expect(camera.start()).rejects.toThrow(message);
  });

  it('stops every track and discards a late stream after navigation', async () => {
    const stop = vi.fn();
    let resolveStream!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    const devices = { getUserMedia: vi.fn().mockReturnValue(pending) } as unknown as MediaDevices;
    const camera = new CameraSession(devices);
    const started = camera.start();
    camera.stop();
    resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await expect(started).resolves.toBeNull();
    expect(stop).toHaveBeenCalledOnce();
  });
});
