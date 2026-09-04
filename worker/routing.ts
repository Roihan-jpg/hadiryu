export function isApiRequest(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/health';
}
