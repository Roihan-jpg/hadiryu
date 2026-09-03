type UpstreamFetch = (request: Request) => Promise<Response>;

type WorkerEnvironment = {
  API_ORIGIN?: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

function unavailableResponse(status: number): Response {
  return Response.json(
    {
      error: {
        code: 'API_UNAVAILABLE',
        message: 'Backend sementara belum terhubung',
      },
    },
    { status },
  );
}

function resolveApiOrigin(value: string | undefined): URL | undefined {
  if (!value) return undefined;

  try {
    const origin = new URL(value);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
      return undefined;
    }
    return origin;
  } catch {
    return undefined;
  }
}

export async function proxyApiRequest(
  request: Request,
  apiOrigin: string | undefined,
  upstreamFetch: UpstreamFetch = fetch,
): Promise<Response> {
  const origin = resolveApiOrigin(apiOrigin);
  if (!origin) return unavailableResponse(503);

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${incomingUrl.pathname}${incomingUrl.search}`,
    origin,
  );

  try {
    return await upstreamFetch(new Request(upstreamUrl, request));
  } catch {
    return unavailableResponse(502);
  }
}

function isApiRequest(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    if (isApiRequest(new URL(request.url).pathname)) {
      return proxyApiRequest(request, env.API_ORIGIN);
    }

    return env.ASSETS.fetch(request);
  },
};
