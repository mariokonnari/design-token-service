/**
 * The fetch wrapper every API call goes through (ADR 0016).
 *
 * - Same-origin only: the path must be a plain `/api/...` path (the Vite proxy or
 *   the host's rewrite forwards it), credentials are `same-origin`, so the HttpOnly
 *   session cookie travels and nothing else is needed. No Authorization header, and
 *   nothing is ever written to localStorage, sessionStorage or document.cookie.
 * - JSON in and out. A request with no body sends no body and no content-type.
 * - Every failure is one `ApiError` {status, code, message, details, requestId,
 *   retryAfterSeconds}. Status 0 is "the network failed". A reply that is not the
 *   API's own error shape (a proxy's HTML page, a body that is not JSON) is
 *   `UNKNOWN` with a generic message: the body is never echoed.
 * - The ONE auth-expired signal: a 401 from any endpoint except login, signup,
 *   logout and /api/me means "your session ended". The caller (App) reacts once,
 *   in one place, instead of every screen handling 401 its own way.
 */

import { parseErrorBody, type ApiErrorBodyDetails } from './errorBody'

export interface ApiErrorInit {
  status: number
  code: string
  message: string
  details?: ApiErrorBodyDetails | undefined
  requestId?: string | undefined
  retryAfterSeconds?: number | undefined
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: ApiErrorBodyDetails | undefined
  readonly requestId: string | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.details = init.details
    this.requestId = init.requestId
    this.retryAfterSeconds = init.retryAfterSeconds
  }
}

export interface RequestOptions {
  signal?: AbortSignal
}

export interface ApiClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>
  /** `del`: `delete` is a reserved word. A DELETE carries no body (the version travels in the query). */
  del<T>(path: string, options?: RequestOptions): Promise<T>
}

export interface ApiClientOptions {
  /** Injected so tests need no network. Defaults to the global fetch. */
  fetch?: typeof fetch
  /** Called once per 401 on an endpoint that is not an auth endpoint. */
  onAuthExpired?: () => void
}

/** A 401 here is an ordinary answer (wrong password, "not signed in"), not an expired session. */
const NO_EXPIRY_SIGNAL = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/me',
])

/** `/api/` followed by printable ASCII, with no dot segments, empty segments or backslashes. */
const API_PATH = /^\/api\/[!-~]+$/

function assertApiPath(path: string): void {
  const segments = path.split(/[?#]/, 1)[0]?.split('/') ?? []
  if (
    !API_PATH.test(path) ||
    path.includes('\\') ||
    segments.slice(1).some((s) => s === '..' || s === '.') ||
    segments.slice(2).some((s) => s === '')
  ) {
    throw new Error(
      `Refusing to request "${path}": only /api/ paths are allowed`,
    )
  }
}

const GENERIC_MESSAGE = 'The server sent a reply this app does not understand.'
const NETWORK_MESSAGE = 'The server could not be reached.'

/** Whole seconds only; an HTTP date, a float, a negative or an absurd value is ignored. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d{1,6}$/.test(header)) return undefined
  return Number(header)
}

/** The request id the API puts in a header; shown to people, so only a plain token passes. */
function parseRequestId(header: string | null): string | undefined {
  return header !== null && /^[A-Za-z0-9-]{8,64}$/.test(header)
    ? header
    : undefined
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch: typeof fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    requestOptions: RequestOptions | undefined,
  ): Promise<T> {
    assertApiPath(path)

    const headers = new Headers({ accept: 'application/json' })
    const init: RequestInit = {
      method,
      headers,
      credentials: 'same-origin',
    }
    if (body !== undefined) {
      headers.set('content-type', 'application/json')
      init.body = JSON.stringify(body)
    }
    if (requestOptions?.signal !== undefined)
      init.signal = requestOptions.signal

    let response: Response
    try {
      response = await doFetch(path, init)
    } catch (error) {
      // A cancelled request (navigation, unmount) is not a failure of the API.
      if (isAbort(error)) throw error
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: NETWORK_MESSAGE,
      })
    }

    const requestId = parseRequestId(response.headers.get('x-request-id'))
    const text = await response.text().catch(() => '')

    if (response.ok) {
      if (response.status === 204 || text === '') return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new ApiError({
          status: response.status,
          code: 'UNKNOWN',
          message: GENERIC_MESSAGE,
          requestId,
        })
      }
    }

    const parsed = parseErrorBody(text)
    const error = new ApiError({
      status: response.status,
      code: parsed?.code ?? 'UNKNOWN',
      message: parsed?.message ?? GENERIC_MESSAGE,
      details: parsed?.details,
      requestId,
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    })

    const route = path.split(/[?#]/, 1)[0] ?? path
    if (response.status === 401 && !NO_EXPIRY_SIGNAL.has(route)) {
      options.onAuthExpired?.()
    }
    throw error
  }

  return {
    get: (path, requestOptions) => send('GET', path, undefined, requestOptions),
    post: (path, body, requestOptions) =>
      send('POST', path, body, requestOptions),
    put: (path, body, requestOptions) =>
      send('PUT', path, body, requestOptions),
    del: (path, requestOptions) =>
      send('DELETE', path, undefined, requestOptions),
  }
}
