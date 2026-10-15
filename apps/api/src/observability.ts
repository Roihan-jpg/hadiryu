import { randomUUID } from 'node:crypto';

import type { Request, RequestHandler, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SENSITIVE_VALUE_PATTERN =
  /\b(password|passphrase|token|secret|cookie|authorization|api[-_]?key)\s*([=:])\s*([^\s,;]+)/gi;
const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll('-', '').replaceAll('_', '').toLowerCase();
  if (normalized === 'mustchangepassword') return false;
  return (
    /(password|passphrase|token|secret|cookie|authorization|apikey|servicekey)$/.test(
      normalized,
    ) || /(latitude|longitude)$/.test(normalized)
    || /^(frames?|images?|templates?|ciphertext|nonce|authtag)$/.test(normalized)
    || /(embedding|facetemplate|encryptedtemplate|rawimage|rawframe|capturedframe|biometric|facematchscore|padscore|spoofscore|livenessscore)/.test(normalized)
  );
}

export interface AppLogRecord {
  event: string;
  [key: string]: unknown;
}

export interface AppLogger {
  info(record: AppLogRecord): void;
  error(record: AppLogRecord): void;
}

export const silentLogger: AppLogger = {
  info() {},
  error() {},
};

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_VALUE_PATTERN, (_match, name, separator) =>
      `${String(name)}${String(separator)}${REDACTED}`,
    );
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { errorName: value.name };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? REDACTED : sanitizeValue(entry, seen),
    ]),
  );
}

export function sanitizeLogRecord(record: AppLogRecord): AppLogRecord {
  return sanitizeValue(record, new WeakSet()) as AppLogRecord;
}

export function createStructuredLogger(
  writeLine: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): AppLogger {
  const write = (level: 'info' | 'error', record: AppLogRecord) => {
    writeLine(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        ...sanitizeLogRecord(record),
      }),
    );
  };
  return {
    info(record) {
      write('info', record);
    },
    error(record) {
      write('error', record);
    },
  };
}

export function requestId(response: Response): string | undefined {
  return response.locals['requestId'] as string | undefined;
}

function endpoint(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string' ? route.path : 'unmatched';
}

export function createRequestObservabilityMiddleware(
  logger: AppLogger,
): RequestHandler {
  return (request, response, next) => {
    const suppliedRequestId = request.get('x-request-id');
    const currentRequestId =
      suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
        ? suppliedRequestId
        : randomUUID();
    const startedAt = process.hrtime.bigint();
    response.locals['requestId'] = currentRequestId;
    response.setHeader('X-Request-ID', currentRequestId);

    response.once('finish', () => {
      const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
      const authUser = response.locals['authUser'] as { id?: unknown } | undefined;
      logger.info({
        event: 'http.request.completed',
        requestId: currentRequestId,
        method: request.method,
        endpoint: endpoint(request),
        status: response.statusCode,
        durationMs: Math.round(Number(elapsedNanoseconds) / 10_000) / 100,
        ...(typeof authUser?.id === 'string' ? { userId: authUser.id } : {}),
        ...(typeof response.locals['errorCode'] === 'string'
          ? { errorCode: response.locals['errorCode'] }
          : {}),
      });
    });
    next();
  };
}

export function logRequestFailure(
  logger: AppLogger,
  request: Request,
  response: Response,
  error: unknown,
): void {
  const authUser = response.locals['authUser'] as { id?: unknown } | undefined;
  const internalErrorCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : undefined;
  logger.error({
    event: 'http.request.failed',
    ...(requestId(response) ? { requestId: requestId(response) } : {}),
    method: request.method,
    endpoint: endpoint(request),
    ...(typeof authUser?.id === 'string' ? { userId: authUser.id } : {}),
    errorName: error instanceof Error ? error.name : 'UnknownError',
    ...(internalErrorCode ? { internalErrorCode } : {}),
  });
}

export function createNotFoundHandler(): RequestHandler {
  return (_request: Request, response: Response) => {
    response.locals['errorCode'] = 'NOT_FOUND';
    response.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' },
    });
  };
}
