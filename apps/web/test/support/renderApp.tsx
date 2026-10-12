import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { createApiClient } from '../../src/api/client'
import { createEndpoints } from '../../src/api/endpoints'
import { App } from '../../src/App'
import { handleAuthExpired } from '../../src/auth/me'
import { createQueryClient } from '../../src/queryClient'

/**
 * Renders the whole app on a MemoryRouter with a FAKE fetch (no network, no mocking
 * library): each request is answered by a handler registered for "METHOD /path".
 * A request nobody registered is answered 599 and recorded in `unexpected`;
 * tests assert `expect(app.unexpected).toEqual([])` so a screen cannot quietly call
 * something the test did not expect.
 */

export interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Rejects like a network failure. */
  networkError?: boolean
  /** Resolves only when the test calls the returned release function. */
  hold?: Promise<void>
}
export type Handler = Reply | ((request: RecordedRequest) => Reply)

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

export const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'person@example.com',
  createdAt: '2026-10-12T10:00:00.000Z',
}

export function org(
  overrides: Partial<{
    id: string
    slug: string
    name: string
    role: 'OWNER' | 'EDITOR' | 'VIEWER'
  }> = {},
) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'acme',
    name: 'Acme',
    role: 'OWNER' as const,
    ...overrides,
  }
}

export function brand(
  overrides: Partial<{
    id: string
    slug: string
    name: string
    visibility: 'PRIVATE' | 'PUBLIC'
    draftRevision: number
  }> = {},
) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'summit',
    name: 'Summit',
    visibility: 'PRIVATE' as const,
    draftRevision: 0,
    createdAt: '2026-10-12T10:05:00.000Z',
    ...overrides,
  }
}

export const apiError = (
  status: number,
  code: string,
  message = 'A fixed server sentence.',
  details?: Record<string, unknown>,
): Reply => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
})

export const UNAUTHENTICATED = apiError(
  401,
  'UNAUTHENTICATED',
  'Authentication required.',
)

function toResponse(reply: Reply): Response {
  const status = reply.status ?? 200
  const headers = new Headers({ 'x-request-id': 'req-00000001' })
  for (const [name, value] of Object.entries(reply.headers ?? {})) {
    headers.set(name, value)
  }
  if (status === 204 || reply.body === undefined) {
    return new Response(null, { status, headers })
  }
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(reply.body), { status, headers })
}

export function renderApp(options: {
  route?: string
  handlers: Record<string, Handler>
  queryClient?: QueryClient
}) {
  const requests: RecordedRequest[] = []
  const unexpected: string[] = []
  const handlers = { ...options.handlers }

  const fakeFetch: typeof fetch = async (input, init = {}) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.pathname
          : input.url
    const method = init.method ?? 'GET'
    const raw = init.body
    const request: RecordedRequest = {
      method,
      path,
      body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : undefined,
    }
    requests.push(request)
    const handler = handlers[`${method} ${path}`]
    if (handler === undefined) {
      unexpected.push(`${method} ${path}`)
      return toResponse({
        status: 599,
        body: { error: { code: 'X', message: 'unexpected' } },
      })
    }
    const reply = typeof handler === 'function' ? handler(request) : handler
    if (reply.networkError === true) throw new TypeError('Failed to fetch')
    if (reply.hold !== undefined) await reply.hold
    return toResponse(reply)
  }

  const queryClient =
    options.queryClient ?? createQueryClient({ retryDelay: 0 })
  const api = createEndpoints(
    createApiClient({
      fetch: fakeFetch,
      onAuthExpired: () => {
        handleAuthExpired(queryClient)
      },
    }),
  )

  function LocationProbe() {
    const location = useLocation()
    return (
      <output data-testid="location">
        {location.pathname + location.search + location.hash}
      </output>
    )
  }

  const view = render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <LocationProbe />
      <App api={api} queryClient={queryClient} />
    </MemoryRouter>,
  )

  return {
    ...view,
    queryClient,
    requests,
    unexpected,
    /** Requests of one kind, e.g. calls('POST', '/api/auth/login'). */
    calls: (method: string, path: string) =>
      requests.filter((r) => r.method === method && r.path === path),
    /** Replace a handler mid-test (e.g. the list after a create). */
    setHandler: (key: string, handler: Handler) => {
      handlers[key] = handler
    },
    location: () => view.getByTestId('location').textContent,
  }
}

/** A promise you resolve by hand, to hold a response open. */
export function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

export const SIGNED_IN: Record<string, Handler> = {
  'GET /api/me': { body: { user } },
}
