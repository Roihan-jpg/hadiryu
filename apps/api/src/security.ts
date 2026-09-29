import cors from 'cors';
import type { RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';

import { AppError, sendAppError } from './auth.js';

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface SecurityConfig {
  production: boolean;
  edgeValidatedOrigin: boolean;
  allowedOrigins: readonly string[];
  authRateLimit: RateLimitConfig;
  attendanceRateLimit: RateLimitConfig;
  trustProxy?: number;
}

export const defaultSecurityConfig: SecurityConfig = {
  production: process.env['NODE_ENV'] === 'production',
  edgeValidatedOrigin: false,
  allowedOrigins: [],
  authRateLimit: { windowMs: 15 * 60_000, max: 20 },
  attendanceRateLimit: { windowMs: 60_000, max: 30 },
};

export function resolveSecurityConfig(
  input: Partial<SecurityConfig> | undefined,
): SecurityConfig {
  return {
    production: input?.production ?? defaultSecurityConfig.production,
    edgeValidatedOrigin:
      input?.edgeValidatedOrigin ?? defaultSecurityConfig.edgeValidatedOrigin,
    allowedOrigins: input?.allowedOrigins ?? defaultSecurityConfig.allowedOrigins,
    authRateLimit: input?.authRateLimit ?? defaultSecurityConfig.authRateLimit,
    attendanceRateLimit:
      input?.attendanceRateLimit ?? defaultSecurityConfig.attendanceRateLimit,
    ...(input?.trustProxy === undefined ? {} : { trustProxy: input.trustProxy }),
  };
}

export function createSecurityHeadersMiddleware(
  production: boolean,
): RequestHandler {
  return helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // TLS and long-lived HSTS policy are owned by the deployment edge.
    strictTransportSecurity: false,
  });
}

export function createCorsMiddleware(
  allowedOrigins: readonly string[],
): RequestHandler {
  const allowlist = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.get('origin');
    const host = request.get('host');
    const isSameHost = origin !== undefined && host !== undefined && (() => {
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    })();
    if (origin && !allowlist.has(origin) && !isSameHost) {
      next(new AppError(403, 'CORS_ORIGIN_FORBIDDEN', 'Origin request tidak diizinkan'));
      return;
    }
    cors({
      origin: origin ?? false,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'Content-Disposition'],
      maxAge: 600,
    })(request, response, next);
  };
}

export function createCsrfProtectionMiddleware(
  production: boolean,
): RequestHandler {
  return (request, response, next) => {
    if (
      !production ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      request.get('x-requested-with') === 'XMLHttpRequest'
    ) {
      next();
      return;
    }
    sendAppError(
      response,
      new AppError(
        403,
        'CSRF_PROTECTION_REQUIRED',
        'Request tidak dapat diverifikasi',
      ),
    );
  };
}

function rateLimited(response: Response): void {
  sendAppError(
    response,
    new AppError(
      429,
      'RATE_LIMITED',
      'Terlalu banyak permintaan. Silakan coba lagi nanti',
    ),
  );
}

export function createRateLimiter(config: RateLimitConfig): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_request, response) => rateLimited(response),
  });
}
