export function isApiRequest(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health';
}

export function normalizeSameOriginRequest<T extends Request>(request: T): T {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return request;
  const headers = new Headers(request.headers);
  headers.delete('origin');
  return new Request(request, { headers }) as T;
}

export function hasForeignOrigin(
  request: Request,
  allowedOrigins: readonly string[] = [],
): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  return (
    origin !== new URL(request.url).origin && !allowedOrigins.includes(origin)
  );
}
