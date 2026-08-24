import express, { type Express } from 'express';
import type { HealthResponse } from '@absensi/contracts';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_request, response) => {
    const body: HealthResponse = { status: 'ok' };

    response.status(200).json(body);
  });

  return app;
}
