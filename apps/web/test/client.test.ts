import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../src/api/client'

// The fetch wrapper. Fetch is injected, so no network and no mocking library.

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(
  reply: (call: Call) => Response | Promise<Response> | never,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const impl = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const call = { url, init }
    calls.push(call)
    try {
      return Promise.resolve(reply(call))
    } catch (error) {
      // The thrown value is passed on untouched (a DOMException from jsdom is not an Error).
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(error)
    }
  }
  return { fetch: impl, calls }
}

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const caught = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('requests', () => {
  it('GET: same-origin credentials, JSON accept, no body, no content-type', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }))
    const client = createApiClient({ fetch })
    await expect(client.get('/api/me')).resolves.toEqual({ ok: true })
    const [call] = calls
    expect(call?.url).toBe('/api/me')
    expect(call?.init.method).toBe('GET')
    expect(call?.init.credentials).toBe('same-origin')
    expect(call?.init.body).toBeUndefined()
    const headers = new Headers(call?.init.headers)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.has('content-type')).toBe(false)
  })

  it('POST with a body: JSON content-type and a JSON string', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { id: 1 }))
    const client = createApiClient({ fetch })
    await client.post('/api/orgs', { name: 'A', slug: 'a' })
    const [call] = calls
    expect(call?.init.method).toBe('POST')
    expect(call?.init.body).toBe('{"name":"A","slug":"a"}')
    expect(new Headers(call?.init.headers).get('content-type')).toBe(
      'application/json',
    )
    expect(call?.init.credentials).toBe('same-origin')
  })

  it('POST without a body sends no body and no content-type (logout)', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(null, { status: 204 }),
    )
    const client = createApiClient({ fetch })
    await expect(client.post('/api/auth/logout')).resolves.toBeUndefined()
    const [call] = calls
    expect(call?.init.body).toBeUndefined()
    expect(new Headers(call?.init.headers).has('content-type')).toBe(false)
  })

  it('passes an abort signal through (TanStack Query cancels with it)', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}))
    const controller = new AbortController()
    await createApiClient({ fetch }).get('/api/me', {
      signal: controller.signal,
    })
    expect(calls[0]?.init.signal).toBe(controller.signal)
  })

  it.each([
    'https://evil.example/api/me',
    '//evil.example/api/me',
    '/other',
    'api/me',
    '/api/../etc',
    '',
  ])(
    'refuses to request anything but a same-origin /api/ path: %j',
    async (path) => {
      const { fetch, calls } = fakeFetch(() => json(200, {}))
      const client = createApiClient({ fetch })
      await expect(client.get(path)).rejects.toThrow()
      expect(calls).toHaveLength(0)
    },
  )
})

describe('errors', () => {
  it('normalizes the API error body, the request id and the status', async () => {
    const { fetch } = fakeFetch(() =>
      json(
        409,
        { error: { code: 'SLUG_TAKEN', message: 'Taken.', details: { a: 1 } } },
        { 'x-request-id': 'req-12345678' },
      ),
    )
    const error = await caught(
      createApiClient({ fetch }).post('/api/orgs', { name: 'A', slug: 'a' }),
    )
    expect(error).toMatchObject({
      status: 409,
      code: 'SLUG_TAKEN',
      message: 'Taken.',
      details: { a: 1 },
      requestId: 'req-12345678',
      retryAfterSeconds: undefined,
    })
  })

  it('leaves the request id undefined when the header is missing', async () => {
    const { fetch } = fakeFetch(() =>
      json(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } }),
    )
    const error = await caught(
      createApiClient({ fetch }).get('/api/orgs/x/brands'),
    )
    expect(error.requestId).toBeUndefined()
    expect(error.details).toBeUndefined()
  })

  it.each([429, 503])(
    'exposes Retry-After as seconds on a %i',
    async (status) => {
      const { fetch } = fakeFetch(() =>
        json(
          status,
          { error: { code: 'RATE_LIMITED', message: 'Slow down.' } },
          { 'retry-after': '120' },
        ),
      )
      const error = await caught(createApiClient({ fetch }).get('/api/me'))
      expect(error.retryAfterSeconds).toBe(120)
    },
  )

  it.each([
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['text', 'soon'],
    ['a negative number', '-5'],
    ['a float', '1.5'],
    ['an exponent', '1e3'],
    ['hex', '0x10'],
    ['a huge number', '99999999999'],
    ['empty', ''],
  ])('ignores a Retry-After that is %s', async (_label, value) => {
    const { fetch } = fakeFetch(() =>
      json(
        429,
        { error: { code: 'RATE_LIMITED', message: 'x' } },
        { 'retry-after': value },
      ),
    )
    const error = await caught(createApiClient({ fetch }).get('/api/me'))
    expect(error.retryAfterSeconds).toBeUndefined()
  })

  it('a network failure becomes status 0 NETWORK_ERROR', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const error = await caught(createApiClient({ fetch }).get('/api/me'))
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(error.message).not.toContain('Failed to fetch')
  })

  it('an aborted request is re-thrown as the AbortError (it is not an API failure)', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    const { fetch } = fakeFetch(() => {
      throw abort
    })
    await expect(createApiClient({ fetch }).get('/api/me')).rejects.toBe(abort)
  })

  it('an HTML error page from a proxy is UNKNOWN, with a generic message and no echo of the body', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          '<html><body>Bad gateway <script>x()</script></body></html>',
          {
            status: 502,
            headers: { 'content-type': 'text/html' },
          },
        ),
    )
    const error = await caught(createApiClient({ fetch }).get('/api/me'))
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN' })
    expect(error.message).not.toContain('script')
  })

  it.each([
    ['no error key', {}],
    ['a non-object error', { error: 'bad' }],
    ['a numeric code', { error: { code: 5, message: 'x' } }],
    ['a non-string message', { error: { code: 'X', message: { a: 1 } } }],
  ])(
    'a JSON body with %s is UNKNOWN with a generic message',
    async (_label, body) => {
      const { fetch } = fakeFetch(() => json(500, body))
      const error = await caught(createApiClient({ fetch }).get('/api/me'))
      expect(error.status).toBe(500)
      expect(error.code).toMatch(/^(UNKNOWN|X)$/)
      expect(typeof error.message).toBe('string')
    },
  )

  it('an unparseable 200 is an error, not a value', async () => {
    const { fetch } = fakeFetch(() => new Response('not json', { status: 200 }))
    const error = await caught(createApiClient({ fetch }).get('/api/me'))
    expect(error.code).toBe('UNKNOWN')
  })

  it('details that are not an object are dropped', async () => {
    const { fetch } = fakeFetch(() =>
      json(400, { error: { code: 'X', message: 'm', details: 'text' } }),
    )
    const error = await caught(createApiClient({ fetch }).get('/api/me'))
    expect(error.details).toBeUndefined()
  })
})

describe('the single auth-expired signal', () => {
  const unauthorized = () =>
    json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })

  it('fires once for a 401 on an ordinary endpoint, and the call still rejects', async () => {
    const onAuthExpired = vi.fn()
    const { fetch } = fakeFetch(unauthorized)
    const client = createApiClient({ fetch, onAuthExpired })
    const error = await caught(client.get('/api/orgs'))
    expect(error.status).toBe(401)
    expect(onAuthExpired).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['login', '/api/auth/login'],
    ['signup', '/api/auth/signup'],
    ['logout', '/api/auth/logout'],
    ['me (just "not signed in")', '/api/me'],
  ])('does NOT fire for a 401 on %s', async (_label, path) => {
    const onAuthExpired = vi.fn()
    const { fetch } = fakeFetch(unauthorized)
    const client = createApiClient({ fetch, onAuthExpired })
    await caught(client.post(path, { email: 'a', password: 'b' }))
    await caught(client.get(path))
    expect(onAuthExpired).not.toHaveBeenCalled()
  })

  it.each([403, 404, 409, 429, 500, 503])(
    'does not fire for a %i',
    async (status) => {
      const onAuthExpired = vi.fn()
      const { fetch } = fakeFetch(() =>
        json(status, { error: { code: 'X', message: 'x' } }),
      )
      await caught(createApiClient({ fetch, onAuthExpired }).get('/api/orgs'))
      expect(onAuthExpired).not.toHaveBeenCalled()
    },
  )

  it('works without a handler', async () => {
    const { fetch } = fakeFetch(unauthorized)
    await caught(createApiClient({ fetch }).get('/api/orgs'))
  })
})

describe('nothing is kept in the browser', () => {
  it('never touches localStorage, sessionStorage or document.cookie', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const cookie = vi.spyOn(Document.prototype, 'cookie', 'set')
    const { fetch } = fakeFetch(() =>
      json(200, { user: { id: 'u', email: 'a@b.c', createdAt: 'x' } }),
    )
    const client = createApiClient({ fetch })
    await client.post('/api/auth/login', { email: 'a@b.c', password: 'secret' })
    await client.get('/api/me')
    expect(getItem).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(cookie).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('never sends an Authorization header (the session is an HttpOnly cookie)', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}))
    await createApiClient({ fetch }).get('/api/me')
    expect(new Headers(calls[0]?.init.headers).has('authorization')).toBe(false)
  })
})
