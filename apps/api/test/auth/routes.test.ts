import { SignJWT } from 'jose'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createPasswordService,
  defaultDeriveKey,
} from '../../src/auth/password'
import { SESSION_AUDIENCE, SESSION_ISSUER } from '../../src/auth/session'
import { createPrismaClient } from '../../src/db/client'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  FAST_SCRYPT,
  PASSWORD,
  SESSION_SECRET,
  authApp,
  post,
  setCookies,
  signUp,
  tokenFrom,
  withToken,
} from '../support/authApp'
import { ALLOWED_ORIGIN } from '../support/http'

// The auth routes against a REAL Postgres, through the real middleware stack.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface Body {
  error?: { code: string; message: string }
  user?: { id: string; email: string; createdAt: string }
}
const bodyOf = (response: request.Response) => response.body as Body

const GENERIC_LOGIN = {
  error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
}

describe('POST /api/auth/signup', () => {
  it('creates the account, logs the user in, and /me then works with the cookie', async () => {
    const { app } = await authApp(db)
    const agent = request.agent(app)
    const response = await signUp(agent)
    expect(response.status).toBe(201)
    expect(Object.keys(bodyOf(response).user ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'id',
    ])
    expect(bodyOf(response).user?.email).toBe('person@example.com')

    const cookie = setCookies(response)[0] ?? ''
    expect(cookie).toMatch(/^dts_session=[\w-]+\.[\w-]+\.[\w-]+;/)
    expect(cookie.toLowerCase()).toContain('httponly')
    expect(cookie.toLowerCase()).toContain('samesite=lax')

    const me = await agent.get('/api/me')
    expect(me.status).toBe(200)
    expect(bodyOf(me).user).toEqual(bodyOf(response).user)
  })

  it('normalizes the email: stored lowercase, and login works in any case', async () => {
    const { app } = await authApp(db)
    const response = await signUp(request(app), '  Person.Name@Example.COM ')
    expect(response.status).toBe(201)
    expect(bodyOf(response).user?.email).toBe('person.name@example.com')
    const stored = await pool.query('SELECT email FROM "User"')
    expect(stored.rows).toEqual([{ email: 'person.name@example.com' }])
    const login = await post(request(app), '/api/auth/login', {
      email: 'PERSON.NAME@example.com',
      password: PASSWORD,
    })
    expect(login.status).toBe(200)
  })

  it('stores a scrypt hash, never the password', async () => {
    const { app } = await authApp(db)
    await signUp(request(app))
    const stored = await pool.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User"',
    )
    expect(stored.rows[0]?.passwordHash).toMatch(/^scrypt\$N=1024,r=8,p=1\$/)
    expect(stored.rows[0]?.passwordHash).not.toContain(PASSWORD)
  })

  it.each([
    ['not an email', 'person'],
    ['no domain', 'person@'],
    ['no local part', '@example.com'],
    ['spaces inside', 'per son@example.com'],
    ['empty', ''],
    ['too long', `${'a'.repeat(250)}@example.com`],
  ])('rejects an invalid email (%s) with 400', async (_name, email) => {
    const { app } = await authApp(db)
    const response = await signUp(request(app), email)
    expect(response.status).toBe(400)
    expect(bodyOf(response).error?.code).toBe('VALIDATION_ERROR')
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(0)
  })

  it.each([
    ['too short', 'a'.repeat(11), /at least 12/],
    ['too long', 'a'.repeat(129), /at most 128/],
    ['not a string', 123456789012, /string|expected/i],
  ])(
    'rejects a bad password (%s) with 400 and never echoes it',
    async (_name, password, message) => {
      const { app, derivations } = await authApp(db)
      const before = derivations.count
      const response = await post(request(app), '/api/auth/signup', {
        email: 'a@example.com',
        password,
      })
      expect(response.status).toBe(400)
      expect(bodyOf(response).error?.message).toMatch(message)
      expect(JSON.stringify(response.body)).not.toContain(String(password))
      expect(derivations.count).toBe(before) // refused before any hashing
    },
  )

  it('has no composition rules: all-lowercase and all-digit passwords are fine', async () => {
    const { app } = await authApp(db)
    expect(
      (await signUp(request(app), 'a@example.com', 'abcdefghijklm')).status,
    ).toBe(201)
    expect(
      (await signUp(request(app), 'b@example.com', '1234567890123')).status,
    ).toBe(201)
  })

  it('answers 409 EMAIL_TAKEN for a duplicate, in any case', async () => {
    const { app } = await authApp(db)
    expect((await signUp(request(app), 'dup@example.com')).status).toBe(201)
    for (const email of [
      'dup@example.com',
      'DUP@example.com',
      ' Dup@Example.Com ',
    ]) {
      const response = await signUp(request(app), email)
      expect(response.status).toBe(409)
      expect(bodyOf(response).error?.code).toBe('EMAIL_TAKEN')
    }
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(1)
  })

  it('respects SIGNUP_ENABLED=false: 403 SIGNUP_DISABLED, no user, no hashing', async () => {
    const { app, derivations } = await authApp(db, { signupEnabled: false })
    const before = derivations.count
    const response = await signUp(request(app))
    expect(response.status).toBe(403)
    expect(bodyOf(response).error?.code).toBe('SIGNUP_DISABLED')
    expect(derivations.count).toBe(before)
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(0)
  })

  it('never returns the hash', async () => {
    const { app } = await authApp(db)
    const response = await signUp(request(app))
    expect(JSON.stringify(response.body)).not.toMatch(
      /scrypt|passwordHash|password/i,
    )
  })
})

describe('strict request bodies: unknown keys are rejected with 400', () => {
  it.each([
    ['role', { role: 'OWNER' }],
    ['userId', { userId: '11111111-1111-4111-8111-111111111111' }],
    ['id', { id: '11111111-1111-4111-8111-111111111111' }],
    ['isAdmin', { isAdmin: true }],
    ['sessionVersion', { sessionVersion: 99 }],
    ['passwordHash', { passwordHash: 'x' }],
    [
      'organizationId',
      { organizationId: '11111111-1111-4111-8111-111111111111' },
    ],
  ])('signup with an extra %s field', async (_name, extra) => {
    const { app } = await authApp(db)
    const response = await post(request(app), '/api/auth/signup', {
      email: 'a@example.com',
      password: PASSWORD,
      ...extra,
    })
    expect(response.status).toBe(400)
    expect(bodyOf(response).error?.code).toBe('VALIDATION_ERROR')
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(0)
  })

  it('signup with a __proto__ key', async () => {
    const { app } = await authApp(db)
    const response = await request(app)
      .post('/api/auth/signup')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(
        '{"email":"a@example.com","password":"correct horse battery staple","__proto__":{"admin":true}}',
      )
    expect(response.status).toBe(400)
  })

  it.each([
    [
      'login',
      '/api/auth/login',
      { email: 'a@example.com', password: PASSWORD, role: 'OWNER' },
    ],
    [
      'change-password',
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: PASSWORD + '!', userId: 'x' },
    ],
  ])('%s with an extra field', async (_name, path, body) => {
    const { app } = await authApp(db)
    const agent = request.agent(app)
    await signUp(agent)
    const response = await post(agent, path, body)
    expect(response.status).toBe(400)
  })

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"x"'],
    ['a number', '5'],
    ['an empty object', '{}'],
  ])('signup with %s as the body', async (_name, raw) => {
    const { app } = await authApp(db)
    const response = await request(app)
      .post('/api/auth/signup')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json')
      .send(raw)
    expect(response.status).toBe(400)
  })

  it('signup with no body at all', async () => {
    const { app } = await authApp(db)
    expect((await post(request(app), '/api/auth/signup')).status).toBe(400)
  })

  it('logout and logout-all reject a body (they take none)', async () => {
    const { app } = await authApp(db)
    const agent = request.agent(app)
    await signUp(agent)
    expect((await post(agent, '/api/auth/logout', { x: 1 })).status).toBe(400)
    expect((await post(agent, '/api/auth/logout-all', { x: 1 })).status).toBe(
      400,
    )
  })
})

describe('the concurrent duplicate-signup race', () => {
  it('N simultaneous signups with one email: exactly one 201, the rest 409, never a 500', async () => {
    const { app } = await authApp(db, {
      passwords: { concurrency: 4, maxQueue: 100 },
    })
    const N = 16
    const responses = await Promise.all(
      Array.from({ length: N }, () => signUp(request(app), 'race@example.com')),
    )
    const statuses = responses.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 201)).toHaveLength(1)
    expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1)
    expect(statuses.filter((s) => s >= 500)).toHaveLength(0)
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(bodyOf(response).error?.code).toBe('EMAIL_TAKEN')
    }
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(1)
  })

  it('repeats the race several times to give a flaky implementation a chance to fail', async () => {
    const { app } = await authApp(db, {
      passwords: { concurrency: 4, maxQueue: 100 },
    })
    for (let round = 0; round < 5; round++) {
      const email = `round${round}@example.com`
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => signUp(request(app), email)),
      )
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1)
      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0)
    }
  })
})

describe('POST /api/auth/login', () => {
  it('logs in with the right password and sets the session cookie', async () => {
    const { app } = await authApp(db)
    await signUp(request(app))
    const agent = request.agent(app)
    const response = await post(agent, '/api/auth/login', {
      email: 'Person@Example.com',
      password: PASSWORD,
    })
    expect(response.status).toBe(200)
    expect(bodyOf(response).user?.email).toBe('person@example.com')
    expect((await agent.get('/api/me')).status).toBe(200)
  })

  it('gives the SAME generic 401 for a wrong password and for an unknown email', async () => {
    const { app } = await authApp(db)
    await signUp(request(app))
    const wrong = await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: 'not the right password',
    })
    const unknown = await post(request(app), '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'not the right password',
    })
    for (const response of [wrong, unknown]) {
      expect(response.status).toBe(401)
      expect(response.body).toEqual(GENERIC_LOGIN)
      expect(setCookies(response)).toEqual([])
    }
    const names = (r: request.Response) =>
      Object.keys(r.headers)
        .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
        .sort()
    expect(names(wrong)).toEqual(names(unknown))
  })

  it('ALWAYS runs exactly one hash: an unknown email takes the dummy-hash path', async () => {
    const { app, derivations } = await authApp(db)
    await signUp(request(app))

    let before = derivations.count
    await post(request(app), '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'whatever it is',
    })
    expect(derivations.count - before).toBe(1) // the dummy verify

    before = derivations.count
    await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: 'wrong password!',
    })
    expect(derivations.count - before).toBe(1) // the real verify

    before = derivations.count
    await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    expect(derivations.count - before).toBe(1) // success: still one (no rehash needed)
  })

  it('verifies the dummy hash with the current parameters (same cost as a real account)', async () => {
    const { app, passwords } = await authApp(db)
    const seen: string[] = []
    const original = passwords.verifyDummy
    ;(passwords as { verifyDummy: typeof original }).verifyDummy = (
      password,
    ) => {
      seen.push(password)
      return original(password)
    }
    await post(request(app), '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'probe password',
    })
    expect(seen).toEqual(['probe password'])
    expect(passwords.needsRehash(passwords.dummyHash)).toBe(false)
  })

  it('refuses an empty or missing password before hashing anything (400)', async () => {
    const { app, derivations } = await authApp(db)
    const before = derivations.count
    for (const body of [
      { email: 'a@example.com', password: '' },
      { email: 'a@example.com' },
      { password: 'x' },
      { email: 'a@example.com', password: 42 },
    ]) {
      expect((await post(request(app), '/api/auth/login', body)).status).toBe(
        400,
      )
    }
    expect(derivations.count).toBe(before)
  })

  it('upgrades an old hash on a successful login WITHOUT logging other sessions out', async () => {
    const { app, users, sessions } = await authApp(db)
    const weak = await createPasswordService({
      params: { N: 1024, r: 8, p: 1 },
    })
    const created = await users.create({
      email: 'old@example.com',
      passwordHash: await weak.hash(PASSWORD),
    })
    const otherSession = await sessions.sign(created.id, created.sessionVersion)

    // The app's service uses stronger parameters than the stored hash.
    const stronger = await authApp(db, {
      passwords: { params: { N: 2048, r: 8, p: 1 } },
    })
    const login = await post(request(stronger.app), '/api/auth/login', {
      email: 'old@example.com',
      password: PASSWORD,
    })
    expect(login.status).toBe(200)
    const stored = await pool.query<{
      passwordHash: string
      sessionVersion: number
    }>('SELECT "passwordHash", "sessionVersion" FROM "User"')
    expect(
      stored.rows[0]?.passwordHash.startsWith('scrypt$N=2048,r=8,p=1$'),
    ).toBe(true)
    expect(stored.rows[0]?.sessionVersion).toBe(0) // not bumped: the old session still works
    const me = await request(app)
      .get('/api/me')
      .set('Cookie', withToken(otherSession))
    expect(me.status).toBe(200)
    // And the new hash verifies.
    expect(
      (
        await post(request(stronger.app), '/api/auth/login', {
          email: 'old@example.com',
          password: PASSWORD,
        })
      ).status,
    ).toBe(200)
  })

  it('does not rehash when the parameters are already current', async () => {
    const { app } = await authApp(db)
    await signUp(request(app))
    const before = await pool.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User"',
    )
    await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    const after = await pool.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User"',
    )
    expect(after.rows[0]?.passwordHash).toBe(before.rows[0]?.passwordHash)
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the cookie (204), also when nobody is logged in', async () => {
    const { app } = await authApp(db)
    const anonymous = await post(request(app), '/api/auth/logout')
    expect(anonymous.status).toBe(204)
    expect(setCookies(anonymous)[0]).toMatch(/^dts_session=;/)

    const agent = request.agent(app)
    await signUp(agent)
    expect((await agent.get('/api/me')).status).toBe(200)
    const out = await post(agent, '/api/auth/logout')
    expect(out.status).toBe(204)
    expect((await agent.get('/api/me')).status).toBe(401)
  })

  it('DOCUMENTED GAP: logout only clears the cookie; a captured token stays valid until logout-all', async () => {
    const { app } = await authApp(db)
    const agent = request.agent(app)
    const captured = tokenFrom(await signUp(agent))
    await post(agent, '/api/auth/logout')
    const replay = await request(app)
      .get('/api/me')
      .set('Cookie', withToken(captured))
    expect(replay.status).toBe(200)
  })
})

describe('POST /api/auth/logout-all', () => {
  it('revokes every session: the old cookie stops working, on this and other devices', async () => {
    const { app } = await authApp(db)
    const first = request.agent(app)
    const tokenBefore = tokenFrom(await signUp(first))
    const second = request.agent(app)
    await post(second, '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    expect((await second.get('/api/me')).status).toBe(200)

    const out = await post(first, '/api/auth/logout-all')
    expect(out.status).toBe(204)
    expect(setCookies(out)[0]).toMatch(/^dts_session=;/)

    expect((await first.get('/api/me')).status).toBe(401)
    expect((await second.get('/api/me')).status).toBe(401)
    const replay = await request(app)
      .get('/api/me')
      .set('Cookie', withToken(tokenBefore))
    expect(replay.status).toBe(401)
    expect(replay.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    })
    // A fresh login works again.
    const again = request.agent(app)
    await post(again, '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    expect((await again.get('/api/me')).status).toBe(200)
  })

  it('requires a session', async () => {
    const { app } = await authApp(db)
    expect((await post(request(app), '/api/auth/logout-all')).status).toBe(401)
  })
})

describe('GET /api/me', () => {
  it('requires a session', async () => {
    const { app } = await authApp(db)
    const response = await request(app).get('/api/me')
    expect(response.status).toBe(401)
    expect(response.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    })
  })

  it('rejects an expired cookie and a tampered one (401, cookie cleared)', async () => {
    const { app } = await authApp(db)
    const agent = request.agent(app)
    const token = tokenFrom(await signUp(agent))

    const key = new TextEncoder().encode(SESSION_SECRET)
    const [, , userSegment] = [
      0,
      0,
      JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
      ) as { sub: string },
    ]
    const expired = await new SignJWT({ sv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userSegment.sub)
      .setIssuer(SESSION_ISSUER)
      .setAudience(SESSION_AUDIENCE)
      .setIssuedAt(1_000)
      .setExpirationTime(2_000)
      .sign(key)
    const [h, p, s] = token.split('.')
    const tampered = `${h}.${p}.${(s ?? '').slice(0, -3)}AAA`
    for (const bad of [expired, tampered, 'garbage']) {
      const response = await request(app)
        .get('/api/me')
        .set('Cookie', withToken(bad))
      expect(response.status).toBe(401)
      expect(setCookies(response)[0]).toMatch(/^dts_session=;/)
    }
  })
})

describe('POST /api/auth/change-password', () => {
  const NEW_PASSWORD = 'a brand new passphrase 42'

  async function loggedIn() {
    const ctx = await authApp(db)
    const agent = request.agent(ctx.app)
    await signUp(agent)
    return { ...ctx, agent }
  }

  it('changes the password, issues a fresh cookie for THIS session and revokes the others', async () => {
    const { app, agent } = await loggedIn()
    const other = request.agent(app)
    await post(other, '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    const oldToken = tokenFrom(
      await post(request(app), '/api/auth/login', {
        email: 'person@example.com',
        password: PASSWORD,
      }),
    )

    const response = await post(agent, '/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    })
    expect(response.status).toBe(204)
    const fresh = tokenFrom(response)
    expect(fresh).not.toBe('')

    // This session continues (with the fresh cookie) ...
    expect((await agent.get('/api/me')).status).toBe(200)
    expect(
      (await request(app).get('/api/me').set('Cookie', withToken(fresh)))
        .status,
    ).toBe(200)
    // ... every other session is gone.
    expect((await other.get('/api/me')).status).toBe(401)
    expect(
      (await request(app).get('/api/me').set('Cookie', withToken(oldToken)))
        .status,
    ).toBe(401)

    // The old password no longer logs in; the new one does.
    const old = await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: PASSWORD,
    })
    expect(old.status).toBe(401)
    const next = await post(request(app), '/api/auth/login', {
      email: 'person@example.com',
      password: NEW_PASSWORD,
    })
    expect(next.status).toBe(200)
  })

  it('refuses a wrong current password (403) and changes nothing', async () => {
    const { agent } = await loggedIn()
    const before = await pool.query<{
      passwordHash: string
      sessionVersion: number
    }>('SELECT "passwordHash", "sessionVersion" FROM "User"')
    const response = await post(agent, '/api/auth/change-password', {
      currentPassword: 'definitely not it',
      newPassword: NEW_PASSWORD,
    })
    expect(response.status).toBe(403)
    expect(bodyOf(response).error?.code).toBe('INVALID_CURRENT_PASSWORD')
    const after = await pool.query(
      'SELECT "passwordHash", "sessionVersion" FROM "User"',
    )
    expect(after.rows).toEqual(before.rows)
    expect((await agent.get('/api/me')).status).toBe(200)
  })

  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(129)],
    ['the same as the current one', PASSWORD],
  ])('refuses a new password that is %s (400)', async (_name, newPassword) => {
    const { agent } = await loggedIn()
    const response = await post(agent, '/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword,
    })
    expect(response.status).toBe(400)
    expect(JSON.stringify(response.body)).not.toContain(newPassword)
  })

  it('requires a session', async () => {
    const { app } = await authApp(db)
    const response = await post(request(app), '/api/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    })
    expect(response.status).toBe(401)
  })
})

describe('CSRF defenses on every state-changing auth route', () => {
  const routes: [string, unknown][] = [
    ['/api/auth/signup', { email: 'a@example.com', password: PASSWORD }],
    ['/api/auth/login', { email: 'a@example.com', password: PASSWORD }],
    ['/api/auth/logout', undefined],
    ['/api/auth/logout-all', undefined],
    [
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'x'.repeat(14) },
    ],
  ]

  it.each(routes)('%s: no Origin header is 403', async (path, body) => {
    const { app } = await authApp(db)
    let test = request(app).post(path)
    if (body !== undefined)
      test = test.set('Content-Type', 'application/json').send(body as object)
    expect((await test).status).toBe(403)
  })

  it.each(routes)('%s: a foreign Origin is 403', async (path, body) => {
    const { app } = await authApp(db)
    let test = request(app)
      .post(path)
      .set('Origin', 'https://evil.example.test')
    if (body !== undefined)
      test = test.set('Content-Type', 'application/json').send(body as object)
    const response = await test
    expect(response.status).toBe(403)
    expect(bodyOf(response).error?.code).toBe('FORBIDDEN_ORIGIN')
  })

  it.each(routes.filter(([, body]) => body !== undefined))(
    '%s: a form-encoded body is 415',
    async (path) => {
      const { app } = await authApp(db)
      const response = await request(app)
        .post(path)
        .set('Origin', ALLOWED_ORIGIN)
        .type('form')
        .send('email=a%40example.com&password=x')
      expect(response.status).toBe(415)
    },
  )

  it('a foreign-origin signup creates no user and sets no cookie', async () => {
    const { app } = await authApp(db)
    const response = await request(app)
      .post('/api/auth/signup')
      .set('Origin', 'https://evil.example.test')
      .set('Content-Type', 'application/json')
      .send({ email: 'a@example.com', password: PASSWORD })
    expect(response.status).toBe(403)
    expect(setCookies(response)).toEqual([])
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(0)
  })
})

describe('secrets never appear in responses or logs', () => {
  it('a full flow leaves no password, hash, token or cookie in the logs or any body', async () => {
    const { app, capture } = await authApp(db)
    const agent = request.agent(app)
    const bodies: unknown[] = []
    const record = (r: request.Response) => {
      bodies.push(r.body)
      return r
    }
    const signup = record(
      await signUp(agent, 'flow@example.com', 'first passphrase 111'),
    )
    const token = tokenFrom(signup)
    record(
      await post(request(app), '/api/auth/login', {
        email: 'flow@example.com',
        password: 'wrong passphrase 222',
      }),
    )
    record(
      await post(request(app), '/api/auth/login', {
        email: 'flow@example.com',
        password: 'first passphrase 111',
      }),
    )
    record(await agent.get('/api/me'))
    const change = record(
      await post(agent, '/api/auth/change-password', {
        currentPassword: 'first passphrase 111',
        newPassword: 'second passphrase 333',
      }),
    )
    record(
      await post(request(app), '/api/auth/signup', {
        email: 'flow@example.com',
        password: 'third passphrase 444',
      }),
    )
    const stored = await pool.query<{ passwordHash: string }>(
      'SELECT "passwordHash" FROM "User"',
    )
    const hash = stored.rows[0]?.passwordHash ?? ''

    const logs = capture.text()
    expect(logs.length).toBeGreaterThan(0)
    for (const secret of [
      'first passphrase 111',
      'wrong passphrase 222',
      'second passphrase 333',
      'third passphrase 444',
      hash,
      token,
      tokenFrom(change),
      'scrypt$',
    ]) {
      expect(secret).not.toBe('')
      expect(logs, secret).not.toContain(secret)
    }
    const everyBody = JSON.stringify(bodies)
    for (const secret of [
      'passphrase',
      'scrypt$',
      'passwordHash',
      hash,
      token,
    ]) {
      expect(everyBody, secret).not.toContain(secret)
    }
  })
})

describe('a mismatched hasher still works (sanity of the test helper)', () => {
  it('creates a password service with the production-shaped API', async () => {
    const service = await createPasswordService({
      params: FAST_SCRYPT,
      deriveKey: defaultDeriveKey,
    })
    expect(service.needsRehash(service.dummyHash)).toBe(false)
  })
})
