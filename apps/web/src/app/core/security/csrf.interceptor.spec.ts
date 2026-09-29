import { HttpRequest, HttpResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { csrfInterceptor } from './csrf.interceptor';

async function intercepted(request: HttpRequest<unknown>) {
  let forwarded: HttpRequest<unknown> | undefined;
  await firstValueFrom(
    csrfInterceptor(request, (nextRequest) => {
      forwarded = nextRequest;
      return of(new HttpResponse({ status: 204 }));
    }),
  );
  return forwarded!;
}

describe('CSRF interceptor', () => {
  it('marks state-changing API requests as XMLHttpRequest', async () => {
    const request = await intercepted(new HttpRequest('POST', '/api/auth/login', {}));

    expect(request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  it('does not add the marker to safe or non-API requests', async () => {
    const safe = await intercepted(new HttpRequest('GET', '/api/auth/me'));
    const external = await intercepted(
      new HttpRequest('POST', 'https://example.com/webhook', {}),
    );

    expect(safe.headers.has('X-Requested-With')).toBe(false);
    expect(external.headers.has('X-Requested-With')).toBe(false);
  });
});
