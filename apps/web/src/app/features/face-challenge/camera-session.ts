export class CameraSession {
  private stream: MediaStream | null = null;
  private generation = 0;

  constructor(private readonly devices: MediaDevices) {}

  async start(): Promise<MediaStream | null> {
    const generation = ++this.generation;
    let stream: MediaStream;
    try {
      stream = await this.devices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
    } catch (error) {
      if (generation !== this.generation) return null;
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw new Error('Akses kamera ditolak. Izinkan kamera lalu coba lagi.', { cause: error });
      if (name === 'NotReadableError' || name === 'TrackStartError') throw new Error('Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.', { cause: error });
      throw new Error('Kamera tidak tersedia. Periksa perangkat dan izin browser.', { cause: error });
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    this.stream = stream;
    const track=stream.getVideoTracks?.()[0];
    try {
      const capabilities=track?.getCapabilities?.() as (MediaTrackCapabilities & {exposureMode?:string[]})|undefined;
      if(capabilities?.exposureMode?.includes('continuous')) {
        const exposure:MediaTrackConstraintSet & {exposureMode:string}={exposureMode:'continuous'};
        await track!.applyConstraints({advanced:[exposure]});
      }
    } catch { /* Optional camera controls must not prevent opening the camera. */ }
    if(generation!==this.generation)return null;
    return stream;
  }

  stop(): void {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
