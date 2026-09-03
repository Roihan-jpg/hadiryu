import { describe, expect, it, vi } from 'vitest';

import { proxyApiRequest } from './index.js';

describe('proxyApiRequest', () => {
  it('forwards the API path, query, method, and request headers to the tunnel', async () => {
    const request = new Request(
      'https://absensi-guru.roihanboizz2006.workers.dev/api/auth/me?refresh=true',
      {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        method: 'POST',
      },
    );
    const upstreamResponse = new Response('ok', { status: 200 });
    const upstreamFetch = vi.fn().mockResolvedValue(upstreamResponse);

    const response = await proxyApiRequest(
      request,
      'https://temporary-tunnel.trycloudflare.com',
      upstreamFetch,
    );

    expect(upstreamFetch).toHaveBeenCalledOnce();
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0] as Request;
    expect(upstreamRequest.url).toBe(
      'https://temporary-tunnel.trycloudflare.com/api/auth/me?refresh=true',
    );
    expect(upstreamRequest.method).toBe('POST');
    expect(upstreamRequest.headers.get('X-Requested-With')).toBe(
      'XMLHttpRequest',
    );
    expect(response).toBe(upstreamResponse);
  });

  it('returns a safe error when the tunnel origin has not been configured', async () => {
    const upstreamFetch = vi.fn();

    const response = await proxyApiRequest(
      new Request('https://absensi-guru.roihanboizz2006.workers.dev/api/auth/me'),
      undefined,
      upstreamFetch,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'API_UNAVAILABLE',
        message: 'Backend sementara belum terhubung',
      },
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
