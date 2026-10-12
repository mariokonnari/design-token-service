import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceBusyError,
  UnauthenticatedError,
  ValidationError,
} from '../../src/errors'
import { createLogger, REDACT_PATHS } from '../../src/http/logger'
import { resolveRequestId } from '../../src/http/requestId'
import { ALLOWED_ORIGIN, appWith, logCapture, testRoute } from '../support/http'

// Stage 1: the HTTP skeleton. Everything here runs through the real createApp.

const echo = testRoute('post', '/t/echo', (req, res) => {
  const body: unknown = req.body
  res.json({ body: body ?? null })
})
const login = testRoute('post', '/t/login', (_req, res) => {
  res.status(401).json({ error: { code: 'X', message: 'x' } })
})
const del = testRoute('delete', '/t/item', (_req, res) => {
  res.status(204).end()
})
const ip = testRoute('get', '/t/ip', (req, res) => {
  res.json({ ip: req.ip })
})
const throwing = (name: string, error: () => unknown) =>
  testRoute('get', `/t/${name}`, () => {
    throw error()
  })
const routes = [
  echo,
  login,
  del,
  ip,
  throwing('conflict', () => new ConflictError('That slug is taken.')),
  throwing('forbidden', () => new ForbiddenError('No.')),
  throwing('validation', () => new ValidationError('Bad input.')),
  throwing('unauth', () => new UnauthenticatedError()),
  throwing('notfound', () => new NotFoundError()),
  throwing('busy', () => new ServiceBusyError()),
  throwing('boom', () => new Error('secret detail at C:\\app\\db.ts:12')),
  throwing('zod', () => z.object({ a: z.string() }).strict().parse({ a: 1 })),
  testRoute('get', '/t/async-boom', async () => {
    await Promise.resolve()
    throw new Error('async secret detail')
  }),
]

interface ErrorBody {
  error: { code: string; message: string }
}

const json = (agent: request.Test) =>
  agent.set('Origin', ALLOWED_ORIGIN).set('Content-Type', 'application/json')

describe('request id', () => {
  it('generates one when none is sent and returns it in the header', async () => {
    const { app } = appWith(routes)
    const response = await request(app).get('/health')
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each(['abcd1234', 'A1B2C3D4-E5F6-7890', 'x'.repeat(64)])(
    'accepts the well-formed incoming id %s',
    async (id) => {
      const { app } = appWith(routes)
      const response = await request(app).get('/health').set('X-Request-Id', id)
      expect(response.headers['x-request-id']).toBe(id)
    },
  )

  it.each([
    ['too short', 'abc1234'],
    ['too long', 'x'.repeat(65)],
    ['spaces', 'abcd 1234'],
    ['underscore', 'abcd_1234'],
    ['quotes and braces', 'abcd"}{"injected":true'],
    ['a very long string', 'A'.repeat(3000)],
    ['non ascii', 'abcdéfgh1234'],
    ['empty', ''],
  ])(
    'replaces the hostile incoming id (%s) with a generated one',
    async (_name, id) => {
      const { app } = appWith(routes)
      const response = await request(app).get('/t/ip').set('X-Request-Id', id)
      expect(response.headers['x-request-id']).not.toBe(id)
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    },
  )

  it('never writes a hostile incoming id to the logs verbatim', async () => {
    const hostile = 'A'.repeat(3000)
    const injected = 'abcd"},"level":60,"msg":"forged'
    const { app, capture } = appWith(routes)
    await request(app).get('/t/ip').set('X-Request-Id', hostile)
    await request(app).get('/t/ip').set('X-Request-Id', injected)
    const text = capture.text()
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain(hostile)
    expect(text).not.toContain(injected)
    expect(text).not.toContain('forged')
    // Every line is still one valid JSON record (no line injection).
    expect(() => capture.records()).not.toThrow()
  })

  it('resolveRequestId handles newlines, arrays and non-strings without throwing', () => {
    const uuid = /^[0-9a-f-]{36}$/
    for (const value of [
      'abcd1234\r\ninjected: yes',
      'abcd1234\n',
      ['abcd1234', 'efgh5678'],
      undefined,
      null,
      42,
      {},
    ]) {
      expect(resolveRequestId(value)).toMatch(uuid)
    }
    expect(resolveRequestId('abcd1234')).toBe('abcd1234')
    expect(resolveRequestId(randomUUID())).toMatch(uuid)
  })
})

describe('logging and redaction', () => {
  it('never logs the password, cookie or authorization of a login request', async () => {
    const { app, capture } = appWith(routes)
    const password = 'correct horse battery staple 9!'
    await request(app)
      .post('/t/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', 'dts_session=SESSIONSECRETVALUE123')
      .set('Authorization', 'Bearer BEARERSECRET456')
      .send({ email: 'a@b.co', password })
    const text = capture.text()
    expect(capture.records().length).toBeGreaterThan(0)
    for (const secret of [
      password,
      'SESSIONSECRETVALUE123',
      'BEARERSECRET456',
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('logs one record per request with method, status and request id', async () => {
    const { app, capture } = appWith(routes)
    await request(app).post('/t/login').set('Origin', ALLOWED_ORIGIN).send({})
    const record = capture
      .records()
      .find(
        (r) => (r['req'] as { url?: string } | undefined)?.url === '/t/login',
      )
    expect(record).toBeDefined()
    expect(record?.['res']).toMatchObject({ statusCode: 401 })
    expect(record?.['req']).toMatchObject({ method: 'POST' })
    expect(typeof (record?.['req'] as { id?: string }).id).toBe('string')
  })

  it('does not log the query string', async () => {
    const { app, capture } = appWith(routes)
    await request(app).get('/t/ip?token=QUERYSECRET')
    expect(capture.text()).not.toContain('QUERYSECRET')
  })

  it('does not log the probe endpoints (they would drown the log)', async () => {
    const { app, capture } = appWith(routes)
    await request(app).get('/health')
    await request(app).get('/ready')
    expect(capture.text()).toBe('')
  })

  it('redacts secrets even if a handler logs them in objects (second layer)', () => {
    const capture = logCapture()
    const logger = createLogger({ destination: capture.stream })
    logger.info({
      req: {
        headers: { cookie: 'COOKIEVAL', authorization: 'AUTHVAL' },
        body: { password: 'PW1', currentPassword: 'PW2', newPassword: 'PW3' },
      },
      res: { headers: { 'set-cookie': 'SETCOOKIEVAL' } },
      user: { password: 'PW4', passwordHash: 'HASHVAL' },
      password: 'PW5',
    })
    const text = capture.text()
    for (const secret of [
      'COOKIEVAL',
      'AUTHVAL',
      'PW1',
      'PW2',
      'PW3',
      'PW4',
      'PW5',
      'HASHVAL',
      'SETCOOKIEVAL',
    ]) {
      expect(text, secret).not.toContain(secret)
    }
    expect(text).toContain('[Redacted]')
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(8)
  })
})

describe('security headers', () => {
  it('sets helmet headers and removes x-powered-by', async () => {
    const { app } = appWith(routes)
    const response = await request(app).get('/health')
    expect(response.headers['x-powered-by']).toBeUndefined()
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['strict-transport-security']).toBeDefined()
    expect(response.headers['content-security-policy']).toBeDefined()
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
  })
})

describe('no CORS (same-origin deployment)', () => {
  it('answers a cross-origin preflight without any CORS header', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .options('/t/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
    const cors = Object.keys(response.headers).filter((h) =>
      h.startsWith('access-control-'),
    )
    expect(cors).toEqual([])
    expect(response.status).not.toBe(200)
  })

  it('adds no CORS header to normal responses either, even for an allowed origin', async () => {
    const { app } = appWith(routes)
    const get = await request(app).get('/health').set('Origin', ALLOWED_ORIGIN)
    const post = await json(request(app).post('/t/echo')).send({ a: 1 })
    for (const response of [get, post]) {
      expect(
        Object.keys(response.headers).filter((h) =>
          h.startsWith('access-control-'),
        ),
      ).toEqual([])
    }
  })
})

describe('Origin check on unsafe methods', () => {
  it.each([
    ['no Origin header', undefined],
    ['a different origin', 'https://evil.example.test'],
    ['the literal string null', 'null'],
    ['a trailing slash', `${ALLOWED_ORIGIN}/`],
    ['a different scheme', 'http://app.example.test'],
    ['a different case', ALLOWED_ORIGIN.toUpperCase()],
    ['a subdomain', 'https://x.app.example.test'],
    ['a prefix match', `${ALLOWED_ORIGIN}.evil.test`],
  ])('rejects POST with %s (403)', async (_name, origin) => {
    const { app } = appWith(routes)
    let agent = request(app)
      .post('/t/echo')
      .set('Content-Type', 'application/json')
    if (origin !== undefined) agent = agent.set('Origin', origin)
    const response = await agent.send({ a: 1 })
    expect(response.status).toBe(403)
    expect(response.body).toEqual({
      error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed.' },
    })
  })

  it.each(['post', 'delete'] as const)('applies to %s', async (method) => {
    const { app } = appWith(routes)
    const path = method === 'post' ? '/t/echo' : '/t/item'
    expect((await request(app)[method](path)).status).toBe(403)
  })

  it('accepts the allowed origin', async () => {
    const { app } = appWith(routes)
    const response = await json(request(app).post('/t/echo')).send({ a: 1 })
    expect(response.status).toBe(200)
  })

  it('does not apply to safe methods', async () => {
    const { app } = appWith(routes)
    expect((await request(app).get('/t/ip')).status).toBe(200)
    expect((await request(app).head('/t/ip')).status).toBe(200)
  })

  it('rejects every unsafe request when ALLOWED_ORIGINS is empty', async () => {
    const { app } = appWith(routes, { config: { allowedOrigins: [] } })
    const response = await request(app)
      .post('/t/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .send({})
    expect(response.status).toBe(403)
  })

  it('runs before the body is parsed (a forbidden origin gets 403, not 400)', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .post('/t/echo')
      .set('Origin', 'https://evil.example.test')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(response.status).toBe(403)
  })
})

describe('content-type enforcement on unsafe methods with a body', () => {
  it.each([
    ['text/plain', 'hello'],
    ['application/x-www-form-urlencoded', 'a=1'],
    ['multipart/form-data; boundary=x', '--x--'],
    ['application/xml', '<a/>'],
    ['application/vnd.api+json', '{"a":1}'],
  ])('answers 415 for %s', async (type, body) => {
    const { app } = appWith(routes)
    const response = await request(app)
      .post('/t/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', type)
      .send(body)
    expect(response.status).toBe(415)
    expect(response.body).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'The request body must be application/json.',
      },
    })
  })

  it('answers 415 when a body has no content-type at all', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .post('/t/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .unset('Content-Type')
      .send(Buffer.from('{"a":1}'))
    expect(response.status).toBe(415)
  })

  it('answers 415 for a DELETE with a body of the wrong type', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .delete('/t/item')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('x')
    expect(response.status).toBe(415)
  })

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'Application/JSON',
  ])('accepts %s', async (type) => {
    const { app } = appWith(routes)
    const response = await request(app)
      .post('/t/echo')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', type)
      .send('{"a":1}')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ body: { a: 1 } })
  })

  it('lets a request with no body through without a content type', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .delete('/t/item')
      .set('Origin', ALLOWED_ORIGIN)
    expect(response.status).toBe(204)
  })

  it('does not apply to safe methods', async () => {
    const { app } = appWith(routes)
    const response = await request(app)
      .get('/t/ip')
      .set('Content-Type', 'text/plain')
      .send('x')
    expect(response.status).toBe(200)
  })
})

describe('JSON body parsing', () => {
  it('rejects a body over the size limit with 413', async () => {
    const { app } = appWith(routes)
    const response = await json(request(app).post('/t/echo')).send(
      JSON.stringify({ big: 'x'.repeat(20_000) }),
    )
    expect(response.status).toBe(413)
    expect(response.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
      },
    })
  })

  it('accepts a body just under the limit', async () => {
    const { app } = appWith(routes)
    const response = await json(request(app).post('/t/echo')).send(
      JSON.stringify({ ok: 'x'.repeat(10_000) }),
    )
    expect(response.status).toBe(200)
  })

  it.each(['{not json', '{"a":', '', '[1,', 'undefined'])(
    'answers 400 INVALID_JSON for %j',
    async (body) => {
      const { app } = appWith(routes)
      const response = await json(request(app).post('/t/echo')).send(body)
      // An empty body is "no body": express.json leaves it undefined.
      if (body === '') {
        expect(response.status).toBe(200)
        return
      }
      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        error: {
          code: 'INVALID_JSON',
          message: 'The request body is not valid JSON.',
        },
      })
    },
  )

  it('does not leak the parser error text (positions, snippets)', async () => {
    const { app } = appWith(routes)
    const response = await json(request(app).post('/t/echo')).send(
      '{"secret": nope',
    )
    expect(JSON.stringify(response.body)).not.toMatch(
      /position|Unexpected|nope|token/i,
    )
  })
})

describe('the central error handler', () => {
  it.each([
    ['conflict', 409, 'CONFLICT', 'That slug is taken.'],
    ['forbidden', 403, 'FORBIDDEN', 'No.'],
    ['validation', 400, 'VALIDATION_ERROR', 'Bad input.'],
    ['unauth', 401, 'UNAUTHENTICATED', 'Authentication required.'],
    ['notfound', 404, 'NOT_FOUND', 'Not found.'],
    ['busy', 503, 'SERVICE_BUSY', 'The service is busy. Try again shortly.'],
  ])('maps the typed %s error to %i', async (name, status, code, message) => {
    const { app } = appWith(routes)
    const response = await request(app).get(`/t/${name}`)
    expect(response.status).toBe(status)
    expect(response.body).toEqual({ error: { code, message } })
    expect(response.headers['x-request-id']).toBeDefined()
  })

  it('answers 500 with a generic message for an unknown error, no stack, no detail', async () => {
    const { app } = appWith(routes)
    for (const path of ['/t/boom', '/t/async-boom']) {
      const response = await request(app).get(path)
      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
      })
      expect(JSON.stringify(response.body)).not.toMatch(
        /secret|db\.ts|at |stack/i,
      )
    }
  })

  it('logs the unknown error server side, with its request id', async () => {
    const { app, capture } = appWith(routes)
    const response = await request(app).get('/t/boom')
    const text = capture.text()
    expect(text).toContain('secret detail')
    expect(text).toContain(String(response.headers['x-request-id']))
  })

  it('maps a zod error to 400 without echoing input values', async () => {
    const { app } = appWith(routes)
    const response = await request(app).get('/t/zod')
    expect(response.status).toBe(400)
    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys((response.body as ErrorBody).error).sort()).toEqual([
      'code',
      'message',
    ])
  })

  it('answers unknown routes with a JSON 404 in the same shape', async () => {
    const { app } = appWith(routes)
    const response = await request(app).get('/nope')
    expect(response.status).toBe(404)
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.' },
    })
  })

  it('always returns exactly {error:{code,message}}', async () => {
    const { app } = appWith(routes)
    for (const path of ['/t/conflict', '/t/boom', '/nope', '/t/zod']) {
      const response = await request(app).get(path)
      expect(Object.keys(response.body as object)).toEqual(['error'])
      expect(Object.keys((response.body as ErrorBody).error).sort()).toEqual([
        'code',
        'message',
      ])
    }
  })
})

describe('trust proxy', () => {
  it('ignores X-Forwarded-For when TRUST_PROXY is 0 (the default)', async () => {
    const { app } = appWith(routes, { config: { trustProxy: 0 } })
    const response = await request(app)
      .get('/t/ip')
      .set('X-Forwarded-For', '203.0.113.9')
    expect((response.body as { ip: string }).ip).not.toBe('203.0.113.9')
  })

  it('uses the forwarded client address with one trusted hop', async () => {
    const { app } = appWith(routes, { config: { trustProxy: 1 } })
    const response = await request(app)
      .get('/t/ip')
      .set('X-Forwarded-For', '203.0.113.9')
    expect((response.body as { ip: string }).ip).toBe('203.0.113.9')
  })

  it('with one hop, a client-supplied prefix cannot spoof the address', async () => {
    const { app } = appWith(routes, { config: { trustProxy: 1 } })
    // The proxy appends the real client; the spoofed left part must be ignored.
    const response = await request(app)
      .get('/t/ip')
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.9')
    expect((response.body as { ip: string }).ip).toBe('203.0.113.9')
  })
})
