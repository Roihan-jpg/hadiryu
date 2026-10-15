import { FaceChallengeRequestSchema, type FaceChallengeResponse } from '@absensi/contracts';
import type { Express } from 'express';
import { AppError, createSessionGuard, requireRole, type AuthService } from './auth.js';

export function registerFaceChallengeRoutes(app: Express, authService: AuthService): void {
  app.post('/api/attendance/face/challenge', createSessionGuard(authService), requireRole('USER'), (request, response, next) => {
    try {
      const parsed = FaceChallengeRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Aksi challenge tidak valid', parsed.error.flatten());
      const choices = crypto.getRandomValues(new Uint8Array(2));
      const direction = choices[0]! % 2 === 0 ? 'TURN_LEFT' : 'TURN_RIGHT';
      const body: FaceChallengeResponse = {
        challengeId: crypto.randomUUID(),
        steps: choices[1]! % 2 === 0 ? ['BLINK', direction] : [direction, 'BLINK'],
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      };
      response.status(200).json(body);
    } catch (error) {
      next(error);
    }
  });
}
