import type { HttpInterceptorFn } from '@angular/common/http';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api') || SAFE_METHODS.has(request.method)) {
    return next(request);
  }
  return next(
    request.clone({
      setHeaders: { 'X-Requested-With': 'XMLHttpRequest' },
    }),
  );
};
