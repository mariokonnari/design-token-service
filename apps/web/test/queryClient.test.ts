import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { ME_KEY, handleAuthExpired, signedOut } from '../src/auth/me'
import { createQueryClient, shouldRetry } from '../src/queryClient'

const error = (status: number) =>
  new ApiError({ status, code: 'X', message: 'x' })

describe('shouldRetry (no retries on 4xx)', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])(
    'never retries a %i, however few failures so far',
    (status) => {
      expect(shouldRetry(0, error(status))).toBe(false)
      expect(shouldRetry(1, error(status))).toBe(false)
    },
  )

  it.each([0, 500, 502, 503])('retries a %i once', (status) => {
    expect(shouldRetry(0, error(status))).toBe(true)
    expect(shouldRetry(1, error(status))).toBe(false)
  })

  it('treats anything that is not an ApiError like a transient failure: once', () => {
    expect(shouldRetry(0, new Error('boom'))).toBe(true)
    expect(shouldRetry(1, new Error('boom'))).toBe(false)
  })
})

describe('createQueryClient', () => {
  it('uses that rule for queries, never retries mutations, and does not refetch on focus', () => {
    const defaults = createQueryClient().getDefaultOptions()
    expect(defaults.queries?.retry).toBe(shouldRetry)
    expect(defaults.mutations?.retry).toBe(false)
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false)
  })

  it('takes a retry delay for tests (so none of them has to wait)', () => {
    expect(
      createQueryClient({ retryDelay: 0 }).getDefaultOptions().queries
        ?.retryDelay,
    ).toBe(0)
  })
})

describe('ending a session', () => {
  function seeded(): QueryClient {
    const client = new QueryClient()
    client.setQueryData(ME_KEY, { id: 'u', email: 'a@b.c', createdAt: 't' })
    client.setQueryData(['orgs'], [{ id: 'o' }])
    client.setQueryData(['brands', 'o'], [{ id: 'b' }])
    return client
  }
  const keys = (client: QueryClient) =>
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey[0])

  it('handleAuthExpired marks nobody signed in and drops every other cached query', () => {
    const client = seeded()
    handleAuthExpired(client)
    expect(client.getQueryData(ME_KEY)).toBeNull()
    expect(keys(client)).toEqual(['me'])
  })

  it('handleAuthExpired is idempotent: a burst of 401s acts once', () => {
    const client = seeded()
    handleAuthExpired(client)
    // data loaded after the first 401 (a request already in flight) is not wiped by the second
    client.setQueryData(['orgs'], [{ id: 'late' }])
    handleAuthExpired(client)
    expect(client.getQueryData(['orgs'])).toEqual([{ id: 'late' }])
  })

  it('signedOut (an explicit logout) does the same unconditionally', () => {
    const client = seeded()
    signedOut(client)
    expect(client.getQueryData(ME_KEY)).toBeNull()
    expect(keys(client)).toEqual(['me'])
  })
})
