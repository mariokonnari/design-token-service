import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useApi } from '../ApiContext'
import { ApiError } from '../api/client'
import type { User } from '../api/types'

/** The signed-in user: a User, `null` for "nobody is signed in", never stored in the browser. */
export const ME_KEY = ['me'] as const

export function useMe() {
  const api = useApi()
  return useQuery<User | null>({
    queryKey: ME_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await api.me({ signal })
      } catch (error) {
        // "Not signed in" is an ordinary answer here, not a failure.
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: 5 * 60_000,
  })
}

/** Forget everything the previous session loaded, so nothing of it can be shown to the next person. */
function forgetSession(queryClient: QueryClient): void {
  // `me` first: the screens that need a session leave before anything refetches.
  queryClient.setQueryData(ME_KEY, null)
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== ME_KEY[0],
  })
}

/**
 * The ONE reaction to a 401 from any endpoint (api/client.ts): mark nobody signed
 * in and drop all cached data. RequireAuth then sends the person to /login?next=…
 * Idempotent: a burst of 401s (several queries failing together) acts once.
 */
export function handleAuthExpired(queryClient: QueryClient): void {
  if (queryClient.getQueryData(ME_KEY) === null) return
  forgetSession(queryClient)
}

/** After an explicit logout. */
export function signedOut(queryClient: QueryClient): void {
  forgetSession(queryClient)
}
