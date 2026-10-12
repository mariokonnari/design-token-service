import { SignJWT } from 'jose'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuthenticate, getAuth } from '../../src/auth/authenticate'
import { SESSION_ISSUER, createSessionService } from '../../src/auth/session'
import { createPrismaClient } from '../../src/db/client'
import { UserRepository } from '../../src/repositories/global/users'
import { appWith, testRoute } from '../support/http'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'

// authenticate must load the user and compare the session version on EVERY
// request, and every failure must look identical: 401, a generic body, a cleared cookie.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))
const users = new UserRepository(db)
const SECRET = 'authenticate-test-secret-0123456789abcdef'
const sessions = createSessionService({ secret: SECRET, production: false })

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const whoami = testRoute(
  'get',
  '/t/whoami',
  (_req, res) => {
    const auth = getAuth(res)
    res.json({ userId: auth.userId, email: auth.email })
  },
  { access: 'authenticated' },
)

function build(overrides: { users?: Pick<UserRepository, 'findById'> } = {}) {
  return appWith([whoami], {
    guards: {
      authenticate: createAuthenticate({
        sessions,
        users: overrides.users ?? users,
      }),
    },
  })
}

async function newUser(email = 'person@example.com') {
  return users.create({ email, passwordHash: 'not-a-real-hash' })
}

const cookie = (token: string) => `dts_session=${token}`
const GENERIC = {
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
}

function clearsCookie(response: request.Response) {
  const header =
    (response.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ??
    ''
  return (
    header.startsWith('dts_session=;') &&
    /expires=thu, 01 jan 1970|max-age=0/i.test(header)
  )
}

describe('authenticate: the happy path', () => {
  it('accepts a valid session and exposes the user', async () => {
    const user = await newUser()
    const token = await sessions.sign(user.id, user.sessionVersion)
    const { app } = build()
    const response = await request(app)
      .get('/t/whoami')
      .set('Cookie', cookie(token))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      userId: user.id,
      email: 'person@example.com',
    })
    expect(response.headers['set-cookie']).toBeUndefined()
  })
})

describe('authenticate: every failure is the same 401', () => {
  async function failures() {
    const user = await newUser('victim@example.com')
    const other = await newUser('other@example.com')
    const good = await sessions.sign(user.id, user.sessionVersion)
    const old = createSessionService({
      secret: SECRET,
      production: false,
      now: () => new Date(Date.now() - 8 * 24 * 3600 * 1000),
    })
    const key = new TextEncoder().encode(SECRET)
    const iat = Math.floor(Date.now() / 1000)
    const wrongAudience = await new SignJWT({ sv: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(SESSION_ISSUER)
      .setAudience('someone-else')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 600)
      .sign(key)
    // A real user, a valid signature, but the wrong session version.
    const staleVersion = await sessions.sign(user.id, user.sessionVersion + 1)
    // A valid session for a user that no longer exists.
    const ghost = await sessions.sign('00000000-0000-4000-8000-000000000000', 0)
    // Another person's session id with this user's version.
    const swapped = await sessions.sign(other.id, user.sessionVersion + 5)
    const [h, p, s] = good.split('.')
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p ?? '', 'base64url').toString()), sub: other.id })).toString('base64url')}.${s}`
    return [
      ['no cookie', undefined],
      ['an empty cookie', cookie('')],
      ['garbage', cookie('not.a.jwt')],
      ['a tampered payload', cookie(tampered)],
      ['an expired token', cookie(await old.sign(user.id, 0))],
      ['the wrong audience', cookie(wrongAudience)],
      ['a stale session version', cookie(staleVersion)],
      ['a deleted user', cookie(ghost)],
      ['a swapped user id', cookie(swapped)],
    ] as [string, string | undefined][]
  }

  it('answers 401 with an identical generic body and a cleared cookie in every case', async () => {
    const { app } = build()
    const cases = await failures()
    expect(cases.length).toBeGreaterThanOrEqual(9)
    for (const [name, header] of cases) {
      const agent = request(app).get('/t/whoami')
      const response = await (header === undefined
        ? agent
        : agent.set('Cookie', header))
      expect(response.status, name).toBe(401)
      expect(response.body, name).toEqual(GENERIC)
      expect(clearsCookie(response), `${name} should clear the cookie`).toBe(
        true,
      )
    }
  })

  it('does not reveal why in the headers either (same header names for every failure)', async () => {
    const { app } = build()
    const shapes = new Set<string>()
    for (const [, header] of await failures()) {
      const agent = request(app).get('/t/whoami')
      const response = await (header === undefined
        ? agent
        : agent.set('Cookie', header))
      const names = Object.keys(response.headers)
        .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
        .sort()
        .join(',')
      shapes.add(names)
    }
    expect(shapes.size).toBe(1)
  })
})

describe('authenticate: the user is loaded and the session version compared on EVERY request', () => {
  it('a token stops working the instant the session version is bumped (no caching)', async () => {
    const user = await newUser()
    const token = await sessions.sign(user.id, user.sessionVersion)
    const { app } = build()
    const first = await request(app)
      .get('/t/whoami')
      .set('Cookie', cookie(token))
    expect(first.status).toBe(200)
    await users.bumpSessionVersion(user.id)
    const second = await request(app)
      .get('/t/whoami')
      .set('Cookie', cookie(token))
    expect(second.status).toBe(401)
    expect(clearsCookie(second)).toBe(true)
  })

  it('a token stops working when the user is deleted', async () => {
    const user = await newUser()
    const token = await sessions.sign(user.id, 0)
    const { app } = build()
    expect(
      (await request(app).get('/t/whoami').set('Cookie', cookie(token))).status,
    ).toBe(200)
    await pool.query('DELETE FROM "User" WHERE id = $1', [user.id])
    expect(
      (await request(app).get('/t/whoami').set('Cookie', cookie(token))).status,
    ).toBe(401)
  })

  it('loads the user once per request', async () => {
    const user = await newUser()
    const token = await sessions.sign(user.id, 0)
    let calls = 0
    const counting = {
      findById: (id: string) => {
        calls += 1
        return users.findById(id)
      },
    }
    const { app } = build({ users: counting })
    await request(app).get('/t/whoami').set('Cookie', cookie(token))
    await request(app).get('/t/whoami').set('Cookie', cookie(token))
    expect(calls).toBe(2)
  })

  it('a database failure is a 500 (never a silent 200 and never a misleading 401)', async () => {
    const user = await newUser()
    const token = await sessions.sign(user.id, 0)
    const broken = { findById: () => Promise.reject(new Error('db down')) }
    const { app } = build({ users: broken })
    const response = await request(app)
      .get('/t/whoami')
      .set('Cookie', cookie(token))
    expect(response.status).toBe(500)
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    })
  })

  it('does not call the database at all when the token itself is invalid', async () => {
    let calls = 0
    const counting = {
      findById: () => {
        calls += 1
        return Promise.resolve(null)
      },
    }
    const { app } = build({ users: counting })
    await request(app).get('/t/whoami').set('Cookie', cookie('garbage'))
    await request(app).get('/t/whoami')
    expect(calls).toBe(0)
  })
})

describe('getAuth', () => {
  it('throws if a handler asks for the user on a route that is not authenticated', () => {
    expect(() => getAuth({ locals: {} } as never)).toThrow(/authenticate/)
  })
})
