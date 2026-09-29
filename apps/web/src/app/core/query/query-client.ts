import { HttpErrorResponse } from '@angular/common/http';
import { QueryClient } from '@tanstack/angular-query-experimental';

function retryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: retryRequest,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
