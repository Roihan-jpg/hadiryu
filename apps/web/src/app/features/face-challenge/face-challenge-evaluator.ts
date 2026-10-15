import { FACE_MOTION_POLICY, type FaceChallengeResponse } from '@absensi/contracts';

export interface FrameSignals {
  faceCount: number;
  brightness: number;
  faceWidth: number;
  centered: boolean;
  blinkLeft: number;
  blinkRight: number;
  yaw: number;
}

export type QualityStatus = 'READY' | 'NO_FACE' | 'MULTIPLE_FACES' | 'TOO_DARK' | 'TOO_BRIGHT' | 'TOO_FAR' | 'OFF_CENTER';

export function evaluateFrame(frame: FrameSignals): { status: QualityStatus; message: string } {
  if (frame.faceCount === 0) return { status: 'NO_FACE', message: 'Arahkan wajah ke kamera.' };
  if (frame.faceCount !== 1) return { status: 'MULTIPLE_FACES', message: 'Pastikan hanya satu wajah terlihat.' };
  if (frame.brightness < 55) return { status: 'TOO_DARK', message: 'Pencahayaan kurang. Cari tempat yang lebih terang.' };
  if (frame.brightness > 225) return { status: 'TOO_BRIGHT', message: 'Cahaya terlalu kuat. Hindari sorot langsung.' };
  if (frame.faceWidth < 0.22) return { status: 'TOO_FAR', message: 'Dekatkan wajah ke kamera.' };
  if (!frame.centered) return { status: 'OFF_CENTER', message: 'Posisikan wajah di tengah.' };
  return { status: 'READY', message: 'Wajah siap. Ikuti instruksi challenge.' };
}

export interface ChallengeProgress {
  stepIndex: number;
  sawOpenEyes: boolean;
  sawClosedEyes: boolean;
  neutralYaw: number | null;
}

export function advanceChallenge(progress: ChallengeProgress, step: FaceChallengeResponse['steps'][number], frame: FrameSignals): ChallengeProgress {
  if (evaluateFrame(frame).status !== 'READY') return progress;
  if (step === 'BLINK') {
    const open = frame.blinkLeft < 0.35 && frame.blinkRight < 0.35;
    const closed = frame.blinkLeft > 0.65 && frame.blinkRight > 0.65;
    if (!progress.sawOpenEyes && open) return { ...progress, sawOpenEyes: true };
    if (progress.sawOpenEyes && !progress.sawClosedEyes && closed) return { ...progress, sawClosedEyes: true };
    if (progress.sawClosedEyes && open) return { stepIndex: progress.stepIndex + 1, sawOpenEyes: false, sawClosedEyes: false, neutralYaw: null };
    return progress;
  }
  if (progress.neutralYaw === null) {
    return Math.abs(frame.yaw) < FACE_MOTION_POLICY.neutralYawMaximum ? { ...progress, neutralYaw: frame.yaw } : progress;
  }
  const delta = frame.yaw - progress.neutralYaw;
  if ((step === 'TURN_LEFT' && delta > FACE_MOTION_POLICY.turnYawMinimum) || (step === 'TURN_RIGHT' && delta < -FACE_MOTION_POLICY.turnYawMinimum)) {
    return { ...progress, stepIndex: progress.stepIndex + 1 };
  }
  return progress;
}
