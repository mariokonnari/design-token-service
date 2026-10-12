import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api/client'

/**
 * Retry rule for queries: never retry an answer the server gave on purpose (any
 * 4xx: not signed in, not found, not allowed, rate limited, ...), retry a network
 * failure or a 5xx ONCE. Mutations never retry (a create that is sent twice is a
 * duplicate, ADR 0016).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 1
}

export function createQueryClient(options: { retryDelay?: number } = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        ...(options.retryDelay === undefined
          ? {}
          : { retryDelay: options.retryDelay }),
        staleTime: 30_000,
        // A tab regaining focus must not fire requests that could surprise the
        // person with a sudden redirect; data refreshes on navigation and retry.
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}
