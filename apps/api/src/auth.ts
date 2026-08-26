import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type ApiError,
  type AuthResponse,
  type AuthUser,
  type ChangePasswordRequest,
  type LoginRequest,
  type LogoutResponse,
  type UserRole,
} from '@absensi/contracts';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';

import {
  logRequestFailure,
  type AppLogger,
} from './observability.js';

export const ACCESS_COOKIE_NAME = 'absensi_access';
export const REFRESH_COOKIE_NAME = 'absensi_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

export interface SessionResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthService {
  login(input: LoginRequest): Promise<SessionResult>;
  refresh(refreshToken: string): Promise<SessionResult>;
  authenticate(accessToken: string): Promise<AuthUser>;
  changePassword(
    accessToken: string,
    refreshToken: string,
    input: ChangePasswordRequest,
  ): Promise<SessionResult>;
  logout(accessToken?: string, refreshToken?: string): Promise<void>;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function cookies(request: Request): Record<string, string | undefined> {
  return (request.cookies ?? {}) as Record<string, string | undefined>;
}

export function sendAppError(response: Response, error: AppError): void {
  response.locals['errorCode'] = error.code;
  const body: ApiError = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
  response.status(error.status).json(body);
}

function cookieOptions(secure: boolean, path: string) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    path,
  };
}

function setSessionCookies(
  response: Response,
  session: SessionResult,
  secure: boolean,
): void {
  response.cookie(ACCESS_COOKIE_NAME, session.accessToken, {
    ...cookieOptions(secure, '/api'),
    maxAge: session.expiresIn * 1000,
  });
  response.cookie(
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    {
      ...cookieOptions(secure, '/api/auth'),
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    },
  );
}

function clearSessionCookies(response: Response, secure: boolean): void {
  response.clearCookie(
    ACCESS_COOKIE_NAME,
    cookieOptions(secure, '/api'),
  );
  response.clearCookie(
    REFRESH_COOKIE_NAME,
    cookieOptions(secure, '/api/auth'),
  );
}

export function createSessionGuard(authService: AuthService): RequestHandler {
  return async (request, response, next) => {
    const accessToken = cookies(request)[ACCESS_COOKIE_NAME];
    if (!accessToken) {
      sendAppError(
        response,
        new AppError(401, 'AUTH_REQUIRED', 'Silakan login terlebih dahulu'),
      );
      return;
    }

    try {
      response.locals['authUser'] = await authService.authenticate(accessToken);
      next();
    } catch (error) {
      sendAppError(
        response,
        error instanceof AppError
          ? error
          : new AppError(401, 'AUTH_REQUIRED', 'Sesi tidak valid'),
      );
    }
  };
}

export const requirePasswordChanged: RequestHandler = (
  _request,
  response,
  next,
) => {
  const authUser = response.locals['authUser'] as AuthUser | undefined;
  if (authUser?.mustChangePassword) {
    sendAppError(
      response,
      new AppError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Ganti password awal sebelum melanjutkan',
      ),
    );
    return;
  }
  next();
};

export function requireRole(...allowedRoles: UserRole[]): RequestHandler {
  return (_request, response, next) => {
    const authUser = response.locals['authUser'] as AuthUser | undefined;
    if (authUser?.mustChangePassword) {
      sendAppError(
        response,
        new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Ganti password awal sebelum melanjutkan',
        ),
      );
      return;
    }
    if (!authUser || !allowedRoles.includes(authUser.role)) {
      sendAppError(
        response,
        new AppError(403, 'ROLE_FORBIDDEN', 'Anda tidak memiliki akses'),
      );
      return;
    }
    next();
  };
}

export interface AuthRouteOptions {
  secureCookies?: boolean;
}

export function registerAuthRoutes(
  app: Express,
  authService: AuthService,
  options: AuthRouteOptions = {},
): void {
  const secure = options.secureCookies ?? process.env['NODE_ENV'] === 'production';
  const sessionGuard = createSessionGuard(authService);

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Data login tidak valid',
          parsed.error.flatten(),
        );
      }
      const session = await authService.login(parsed.data);
      setSessionCookies(response, session, secure);
      response.status(200).json({ user: session.user } satisfies AuthResponse);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/refresh', async (request, response, next) => {
    try {
      const refreshToken = cookies(request)[REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        throw new AppError(401, 'AUTH_REQUIRED', 'Refresh token tidak tersedia');
      }
      const session = await authService.refresh(refreshToken);
      setSessionCookies(response, session, secure);
      response.status(200).json({ user: session.user } satisfies AuthResponse);
    } catch (error) {
      clearSessionCookies(response, secure);
      next(error);
    }
  });

  app.get('/api/auth/me', sessionGuard, (_request, response) => {
    const authUser = response.locals['authUser'] as AuthUser;
    response.status(200).json({ user: authUser } satisfies AuthResponse);
  });

  app.post(
    '/api/auth/change-password',
    sessionGuard,
    async (request, response, next) => {
      try {
        const parsed = ChangePasswordRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(
            400,
            'VALIDATION_ERROR',
            'Data password tidak valid',
            parsed.error.flatten(),
          );
        }
        const requestCookies = cookies(request);
        const session = await authService.changePassword(
          requestCookies[ACCESS_COOKIE_NAME]!,
          requestCookies[REFRESH_COOKIE_NAME] ?? '',
          parsed.data,
        );
        setSessionCookies(response, session, secure);
        response
          .status(200)
          .json({ user: session.user } satisfies AuthResponse);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post('/api/auth/logout', async (request, response) => {
    const requestCookies = cookies(request);
    try {
      await authService.logout(
        requestCookies[ACCESS_COOKIE_NAME],
        requestCookies[REFRESH_COOKIE_NAME],
      );
    } catch {
      // Logout remains idempotent even if the upstream session already expired.
    }
    clearSessionCookies(response, secure);
    response.status(200).json({ success: true } satisfies LogoutResponse);
  });
}

function handleAuthError(
  logger: AppLogger,
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): void {
  void _next;
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400 &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    sendAppError(
      response,
      new AppError(400, 'VALIDATION_ERROR', 'JSON request tidak valid'),
    );
    return;
  }
  const sourceError =
    error instanceof AppError
      ? error
      : new AppError(500, 'INTERNAL_ERROR', 'Terjadi kesalahan pada server');
  if (sourceError.status >= 500) {
    logRequestFailure(logger, request, response, error);
    sendAppError(
      response,
      new AppError(500, 'INTERNAL_ERROR', 'Terjadi kesalahan pada server'),
    );
    return;
  }
  sendAppError(response, sourceError);
}

export function createAuthErrorHandler(logger: AppLogger) {
  return (
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction,
  ): void => handleAuthError(logger, error, request, response, next);
}
