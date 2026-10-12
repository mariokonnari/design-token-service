import express from 'express'
import { SignJWT } from 'jose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import {
  SESSION_AUDIENCE,
  SESSION_ISSUER,
  SESSION_TTL_SECONDS,
  createSessionService,
} from '../../src/auth/session'

// jose does the cryptography; these tests prove OUR rules on top of it: the
// algorithm pin, the required claims, the lifetime, and the cookie attributes.

const SECRET = 'unit-test-session-secret-0123456789abcdef'
const USER = '11111111-1111-4111-8111-111111111111'
const T0 = new Date('2026-10-08T12:00:00Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

function service(
  options: { now?: Date; production?: boolean; secret?: string } = {},
) {
  const now = options.now ?? T0
  return createSessionService({
    secret: options.secret ?? SECRET,
    production: options.production ?? false,
    now: () => now,
  })
}

const key = (secret = SECRET) => new TextEncoder().encode(secret)
const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** A token signed by hand so a test can break exactly one rule. */
async function custom(
  claims: Record<string, unknown>,
  options: {
    alg?: 'HS256' | 'HS512'
    issuer?: string | null
    audience?: string | null
    subject?: string | null
    iat?: number | null
    exp?: number | null
    secret?: string
  } = {},
) {
  const iat =
    options.iat === undefined ? Math.floor(T0.getTime() / 1000) : options.iat
  const exp =
    options.exp === undefined ? (iat ?? 0) + SESSION_TTL_SECONDS : options.exp
  let jwt = new SignJWT(claims).setProtectedHeader({
    alg: options.alg ?? 'HS256',
  })
  if (options.subject !== null) jwt = jwt.setSubject(options.subject ?? USER)
  if (options.issuer !== null)
    jwt = jwt.setIssuer(options.issuer ?? SESSION_ISSUER)
  if (options.audience !== null)
    jwt = jwt.setAudience(options.audience ?? SESSION_AUDIENCE)
  if (iat !== null) jwt = jwt.setIssuedAt(iat)
  if (exp !== null) jwt = jwt.setExpirationTime(exp)
  return jwt.sign(key(options.secret))
}

describe('sign and verify', () => {
  it('round trips the user id and session version', async () => {
    const sessions = service()
    const token = await sessions.sign(USER, 4)
    expect(await sessions.verify(token)).toEqual({
      userId: USER,
      sessionVersion: 4,
    })
  })

  it('puts the documented claims in the token: sub, sv, iat, exp (7 days), iss, aud', async () => {
    const token = await service().sign(USER, 2)
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>
    const iat = Math.floor(T0.getTime() / 1000)
    expect(payload).toEqual({
      sub: USER,
      sv: 2,
      iat,
      exp: iat + 7 * 24 * 60 * 60,
      iss: SESSION_ISSUER,
      aud: SESSION_AUDIENCE,
    })
    expect(SESSION_TTL_SECONDS).toBe(604800)
    const header = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>
    expect(header['alg']).toBe('HS256')
  })

  it('accepts the token until the instant it expires, then rejects it', async () => {
    const token = await service().sign(USER, 0)
    expect(
      await service({ now: at(SESSION_TTL_SECONDS - 1) }).verify(token),
    ).not.toBeNull()
    expect(
      await service({ now: at(SESSION_TTL_SECONDS) }).verify(token),
    ).toBeNull()
    expect(
      await service({ now: at(SESSION_TTL_SECONDS + 1) }).verify(token),
    ).toBeNull()
    expect(await service({ now: at(30 * 24 * 3600) }).verify(token)).toBeNull()
  })
})

describe('every rejection returns null (never throws)', () => {
  const bad: [string, () => Promise<string>][] = [
    ['wrong issuer', () => custom({ sv: 1 }, { issuer: 'someone-else' })],
    ['missing issuer', () => custom({ sv: 1 }, { issuer: null })],
    ['wrong audience', () => custom({ sv: 1 }, { audience: 'someone-else' })],
    ['missing audience', () => custom({ sv: 1 }, { audience: null })],
    ['missing subject', () => custom({ sv: 1 }, { subject: null })],
    [
      'subject that is not a uuid',
      () => custom({ sv: 1 }, { subject: 'admin' }),
    ],
    ['missing session version', () => custom({})],
    ['session version as a string', () => custom({ sv: '1' })],
    ['negative session version', () => custom({ sv: -1 })],
    ['fractional session version', () => custom({ sv: 1.5 })],
    ['missing expiry', () => custom({ sv: 1 }, { exp: null })],
    ['missing issued-at', () => custom({ sv: 1 }, { iat: null })],
    ['expired', () => custom({ sv: 1 }, { iat: 1_000, exp: 2_000 })],
    [
      'a lifetime longer than 7 days',
      () =>
        custom(
          { sv: 1 },
          { exp: Math.floor(T0.getTime() / 1000) + 30 * 24 * 3600 },
        ),
    ],
    [
      'issued in the future',
      () =>
        custom(
          { sv: 1 },
          {
            iat: Math.floor(T0.getTime() / 1000) + 3600,
            exp: Math.floor(T0.getTime() / 1000) + 3600 + 600,
          },
        ),
    ],
    [
      'signed with another secret',
      () =>
        custom(
          { sv: 1 },
          { secret: 'a-different-secret-0123456789abcdefghij' },
        ),
    ],
    [
      'HS512 with a valid signature (algorithm not allowed)',
      () => custom({ sv: 1 }, { alg: 'HS512' }),
    ],
  ]

  it.each(bad)('%s', async (_name, make) => {
    expect(await service().verify(await make())).toBeNull()
  })

  it('a tampered payload (session version changed)', async () => {
    const token = await service().sign(USER, 1)
    const [header, payload, signature] = token.split('.')
    const forged = {
      ...(JSON.parse(
        Buffer.from(payload ?? '', 'base64url').toString(),
      ) as object),
      sv: 99,
    }
    expect(
      await service().verify(`${header}.${b64(forged)}.${signature}`),
    ).toBeNull()
  })

  it('a tampered signature', async () => {
    const token = await service().sign(USER, 1)
    const flipped = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA')
    expect(await service().verify(flipped)).toBeNull()
  })

  it.each([
    [
      'alg none without a signature',
      () =>
        `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER, sv: 1, iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, iat: 1791460800, exp: 1792065600 })}.`,
    ],
    [
      'alg none with a signature',
      () =>
        `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER, sv: 1 })}.AAAA`,
    ],
    [
      'alg None (case)',
      () => `${b64({ alg: 'None' })}.${b64({ sub: USER, sv: 1 })}.`,
    ],
    [
      'an empty algorithm',
      () => `${b64({ alg: '' })}.${b64({ sub: USER, sv: 1 })}.AAAA`,
    ],
    [
      'a missing algorithm',
      () => `${b64({})}.${b64({ sub: USER, sv: 1 })}.AAAA`,
    ],
    [
      'an RS256 header',
      () => `${b64({ alg: 'RS256' })}.${b64({ sub: USER, sv: 1 })}.AAAA`,
    ],
    [
      'an embedded jwk header',
      () =>
        `${b64({ alg: 'HS256', jwk: { kty: 'oct', k: 'AAAA' } })}.${b64({ sub: USER, sv: 1 })}.AAAA`,
    ],
  ])('%s', async (_name, make) => {
    expect(await service().verify(make())).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['garbage', 'not.a.jwt'],
    ['one segment', 'abc'],
    ['two segments', 'abc.def'],
    ['four segments', 'a.b.c.d'],
    ['an encrypted-looking five segment token', 'a.b.c.d.e'],
    ['null bytes', 'a\u0000b.c.d'],
    ['unicode', 'ééé.ééé.ééé'],
    ['a huge token (100 KB)', 'a'.repeat(100_000)],
  ])('junk input: %s', async (_name, token) => {
    const started = performance.now()
    expect(await service().verify(token)).toBeNull()
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('non-string input', async () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(await service().verify(value as never)).toBeNull()
    }
  })

  it('a token from one secret is not valid under another', async () => {
    const token = await service().sign(USER, 1)
    expect(
      await service({
        secret: 'rotated-secret-0123456789abcdefghijklmn',
      }).verify(token),
    ).toBeNull()
  })
})

/** Mounts the cookie helpers on a tiny app so the REAL Set-Cookie header can be read. */
function cookieApp(production: boolean) {
  const sessions = service({ production })
  const app = express()
  app.get('/set', (_req, res) => {
    sessions.setCookie(res, 'TOKEN123')
    res.end()
  })
  app.get('/clear', (_req, res) => {
    sessions.clearCookie(res)
    res.end()
  })
  app.get('/read', (req, res) => {
    res.json({ token: sessions.readToken(req) ?? null })
  })
  return { app, sessions }
}

const setCookie = (response: request.Response) =>
  (response.headers['set-cookie'] as unknown as string[])[0] ?? ''

describe('the session cookie', () => {
  it('in production: __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/, 7 days, no Domain', async () => {
    const { app, sessions } = cookieApp(true)
    expect(sessions.cookieName).toBe('__Host-dts_session')
    const header = setCookie(await request(app).get('/set'))
    expect(header.startsWith('__Host-dts_session=TOKEN123;')).toBe(true)
    const attributes = header
      .split('; ')
      .slice(1)
      .map((a) => a.toLowerCase())
    expect(attributes).toContain('httponly')
    expect(attributes).toContain('secure')
    expect(attributes).toContain('samesite=lax')
    expect(attributes).toContain('path=/')
    expect(attributes).toContain(`max-age=${SESSION_TTL_SECONDS}`)
    expect(attributes.some((a) => a.startsWith('domain'))).toBe(false)
  })

  it('outside production: plain name, HttpOnly, SameSite=Lax, Path=/, and NOT Secure', async () => {
    for (const production of [false]) {
      const { app, sessions } = cookieApp(production)
      expect(sessions.cookieName).toBe('dts_session')
      const header = setCookie(await request(app).get('/set'))
      expect(header.startsWith('dts_session=TOKEN123;')).toBe(true)
      const attributes = header
        .split('; ')
        .slice(1)
        .map((a) => a.toLowerCase())
      expect(attributes).toContain('httponly')
      expect(attributes).toContain('samesite=lax')
      expect(attributes).toContain('path=/')
      expect(attributes).not.toContain('secure')
      expect(attributes.some((a) => a.startsWith('domain'))).toBe(false)
    }
  })

  it.each([true, false])(
    'clearing expires the cookie with the same attributes (production=%s)',
    async (production) => {
      const { app, sessions } = cookieApp(production)
      const header = setCookie(await request(app).get('/clear'))
      expect(header.startsWith(`${sessions.cookieName}=;`)).toBe(true)
      expect(header.toLowerCase()).toMatch(/expires=thu, 01 jan 1970|max-age=0/)
      expect(header.toLowerCase()).toContain('path=/')
      expect(header.toLowerCase()).toContain('httponly')
      expect(header.toLowerCase()).toContain('samesite=lax')
      // A __Host- cookie can only be removed by a header that is also Secure.
      expect(header.toLowerCase().includes('secure')).toBe(production)
    },
  )

  it('reads only its own cookie name', async () => {
    const { app } = cookieApp(false)
    const read = async (cookie: string) =>
      (await request(app).get('/read').set('Cookie', cookie)).body as {
        token: string | null
      }
    expect((await read('dts_session=abc.def.ghi')).token).toBe('abc.def.ghi')
    expect((await read('other=1; dts_session=abc; more=2')).token).toBe('abc')
    expect((await read('other=1')).token).toBeNull()
    expect((await read('xdts_session=abc')).token).toBeNull()
    expect((await request(app).get('/read')).body).toEqual({ token: null })
  })

  it('in production the unprefixed cookie is ignored (a subdomain could plant it)', async () => {
    const { app } = cookieApp(true)
    const planted = await request(app)
      .get('/read')
      .set('Cookie', 'dts_session=PLANTED')
    expect((planted.body as { token: string | null }).token).toBeNull()
    const real = await request(app)
      .get('/read')
      .set('Cookie', '__Host-dts_session=REAL')
    expect((real.body as { token: string | null }).token).toBe('REAL')
  })

  it('treats two cookies with the session name as no session at all (cookie tossing)', async () => {
    const { app } = cookieApp(false)
    const response = await request(app)
      .get('/read')
      .set('Cookie', 'dts_session=first; dts_session=second')
    expect((response.body as { token: string | null }).token).toBeNull()
  })

  it('does not choke on malformed Cookie headers', async () => {
    const { app } = cookieApp(false)
    for (const cookie of [
      '=',
      ';;;',
      'dts_session',
      'dts_session=%E0%A4%A',
      'a=b; ; c',
    ]) {
      const response = await request(app).get('/read').set('Cookie', cookie)
      expect(response.status).toBe(200)
    }
  })
})
