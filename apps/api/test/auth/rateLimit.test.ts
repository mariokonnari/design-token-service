import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { DEFAULT_RATE_LIMITS } from '../../src/http/rateLimit'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { PASSWORD, authApp, post, signUp } from '../support/authApp'

// Rate limits, with tiny limits and injected keys so no test has to wait.
// Both login limiters and the signup limiter run BEFORE any hashing.

useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

/** Simulates different client IPs through a header, so tests need no real network addresses. */
const keys = {
  ip: (req: { headers: Record<string, unknown> }) => {
    const header = req.headers['x-test-ip']
    return typeof header === 'string' ? header : 'default-ip'
  },
}
const fromIp = (test: request.Test, ip: string) => test.set('X-Test-Ip', ip)

const login = (
  app: Parameters<typeof request>[0],
  email: string,
  password: string,
  ip = 'ip-1',
) => fromIp(post(request(app), '/api/auth/login', { email, password }), ip)

interface Body {
  error?: { code: string; message: string }
}

describe('the defaults', () => {
  it('are the documented ones', () => {
    expect(DEFAULT_RATE_LIMITS.loginAccount).toEqual({
      windowMs: 15 * 60_000,
      limit: 10,
    })
    expect(DEFAULT_RATE_LIMITS.loginIp).toEqual({
      windowMs: 15 * 60_000,
      limit: 60,
    })
    expect(DEFAULT_RATE_LIMITS.signup).toEqual({
      windowMs: 60 * 60_000,
      limit: 5,
    })
    expect(DEFAULT_RATE_LIMITS.changePassword).toEqual({
      windowMs: 15 * 60_000,
      limit: 5,
    })
  })
})

describe('login: per IP + email, FAILED attempts only', () => {
  it('blocks after the limit with 429 RATE_LIMITED and a Retry-After header', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 3 } },
      keys,
    })
    await signUp(request(app))
    for (let i = 0; i < 3; i++) {
      expect(
        (await login(app, 'person@example.com', 'wrong password!!')).status,
      ).toBe(401)
    }
    const blocked = await login(app, 'person@example.com', 'wrong password!!')
    expect(blocked.status).toBe(429)
    expect((blocked.body as Body).error?.code).toBe('RATE_LIMITED')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('the limiter runs BEFORE hashing: a blocked attempt costs no key derivation', async () => {
    const { app, derivations } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    for (let i = 0; i < 2; i++)
      await login(app, 'a@example.com', 'wrong password!!')
    const before = derivations.count
    const blocked = await login(app, 'a@example.com', 'wrong password!!')
    expect(blocked.status).toBe(429)
    expect(derivations.count).toBe(before)
  })

  it('even the CORRECT password is refused while blocked (no oracle)', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    await signUp(request(app))
    for (let i = 0; i < 2; i++)
      await login(app, 'person@example.com', 'wrong password!!')
    expect((await login(app, 'person@example.com', PASSWORD)).status).toBe(429)
  })

  it('a different EMAIL from the same IP is unaffected', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    for (let i = 0; i < 2; i++)
      await login(app, 'a@example.com', 'wrong password!!')
    expect((await login(app, 'a@example.com', 'wrong password!!')).status).toBe(
      429,
    )
    expect((await login(app, 'b@example.com', 'wrong password!!')).status).toBe(
      401,
    )
  })

  it('the same email from a different IP is unaffected', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    for (let i = 0; i < 2; i++)
      await login(app, 'a@example.com', 'wrong password!!', 'ip-1')
    expect(
      (await login(app, 'a@example.com', 'wrong password!!', 'ip-1')).status,
    ).toBe(429)
    expect(
      (await login(app, 'a@example.com', 'wrong password!!', 'ip-2')).status,
    ).toBe(401)
  })

  it('treats the email case-insensitively (no bypass by changing case)', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    await login(app, 'a@example.com', 'wrong password!!')
    await login(app, 'A@EXAMPLE.COM', 'wrong password!!')
    expect(
      (await login(app, ' a@Example.com ', 'wrong password!!')).status,
    ).toBe(429)
  })

  it('successful logins do not count toward the per-account limit', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 2 } },
      keys,
    })
    await signUp(request(app))
    for (let i = 0; i < 6; i++) {
      expect((await login(app, 'person@example.com', PASSWORD)).status).toBe(
        200,
      )
    }
    // The two allowed failures are still available afterwards.
    expect(
      (await login(app, 'person@example.com', 'wrong password!!')).status,
    ).toBe(401)
    expect(
      (await login(app, 'person@example.com', 'wrong password!!')).status,
    ).toBe(401)
    expect(
      (await login(app, 'person@example.com', 'wrong password!!')).status,
    ).toBe(429)
  })
})

describe('login: the looser per-IP limiter counts ALL attempts', () => {
  it('rotating emails from one IP still hits the per-IP limit', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 1000 }, loginIp: { limit: 5 } },
      keys,
    })
    for (let i = 0; i < 5; i++) {
      // A different, never-seen email every time: the per-account limiter never trips.
      expect(
        (await login(app, `rotating${i}@example.com`, 'wrong password!!'))
          .status,
      ).toBe(401)
    }
    const blocked = await login(
      app,
      'rotating99@example.com',
      'wrong password!!',
    )
    expect(blocked.status).toBe(429)
    expect((blocked.body as Body).error?.code).toBe('RATE_LIMITED')
  })

  it('counts successful logins too', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 1000 }, loginIp: { limit: 3 } },
      keys,
    })
    await signUp(request(app))
    for (let i = 0; i < 3; i++) {
      expect((await login(app, 'person@example.com', PASSWORD)).status).toBe(
        200,
      )
    }
    expect((await login(app, 'person@example.com', PASSWORD)).status).toBe(429)
  })

  it('runs before hashing, and another IP is unaffected', async () => {
    const { app, derivations } = await authApp(db, {
      limits: { loginAccount: { limit: 1000 }, loginIp: { limit: 2 } },
      keys,
    })
    await login(app, 'a@example.com', 'wrong password!!', 'ip-1')
    await login(app, 'b@example.com', 'wrong password!!', 'ip-1')
    const before = derivations.count
    expect(
      (await login(app, 'c@example.com', 'wrong password!!', 'ip-1')).status,
    ).toBe(429)
    expect(derivations.count).toBe(before)
    expect(
      (await login(app, 'c@example.com', 'wrong password!!', 'ip-2')).status,
    ).toBe(401)
  })
})

describe('signup: per IP, all attempts', () => {
  it('blocks after the limit, before any hashing, and another IP is unaffected', async () => {
    const { app, derivations } = await authApp(db, {
      limits: { signup: { limit: 2 } },
      keys,
    })
    const signup = (email: string, ip: string) =>
      fromIp(
        post(request(app), '/api/auth/signup', { email, password: PASSWORD }),
        ip,
      )
    expect((await signup('a@example.com', 'ip-1')).status).toBe(201)
    expect((await signup('a@example.com', 'ip-1')).status).toBe(409) // failures count too
    const before = derivations.count
    const blocked = await signup('b@example.com', 'ip-1')
    expect(blocked.status).toBe(429)
    expect(derivations.count).toBe(before)
    expect((await signup('b@example.com', 'ip-2')).status).toBe(201)
  })
})

describe('change-password: per user', () => {
  it('blocks one user after the limit, before hashing, without affecting another user', async () => {
    const { app, derivations } = await authApp(db, {
      limits: { changePassword: { limit: 2 } },
    })
    const alice = request.agent(app)
    const bob = request.agent(app)
    await signUp(alice, 'alice@example.com')
    await signUp(bob, 'bob@example.com')
    const attempt = (agent: ReturnType<typeof request.agent>) =>
      post(agent, '/api/auth/change-password', {
        currentPassword: 'wrong current password',
        newPassword: 'a brand new passphrase 42',
      })
    expect((await attempt(alice)).status).toBe(403)
    expect((await attempt(alice)).status).toBe(403)
    const before = derivations.count
    expect((await attempt(alice)).status).toBe(429)
    expect(derivations.count).toBe(before)
    expect((await attempt(bob)).status).toBe(403) // bob still has his own budget
  })
})

describe('limit headers', () => {
  it('sends the IETF RateLimit headers (draft-7) and no legacy X-RateLimit headers', async () => {
    const { app } = await authApp(db, {
      limits: { loginIp: { limit: 5 }, loginAccount: { limit: 5 } },
      keys,
    })
    const first = await login(app, 'a@example.com', 'wrong password!!')
    const second = await login(app, 'a@example.com', 'wrong password!!')
    for (const response of [first, second]) {
      expect(response.headers['ratelimit']).toBeDefined()
      expect(response.headers['ratelimit-policy']).toBeDefined()
      expect(
        Object.keys(response.headers).filter((h) =>
          h.startsWith('x-ratelimit'),
        ),
      ).toEqual([])
    }
    const remaining = (r: request.Response) =>
      Number(/remaining=(\d+)/.exec(String(r.headers['ratelimit']))?.[1])
    expect(remaining(second)).toBe(remaining(first) - 1)
    expect(String(first.headers['ratelimit-policy'])).toMatch(/^\d+;w=\d+/)
  })

  it('does not leak the key (IP or email) in any header or body', async () => {
    const { app } = await authApp(db, {
      limits: { loginAccount: { limit: 1 } },
      keys,
    })
    await login(app, 'leaky@example.com', 'wrong password!!', 'ip-secret-9')
    const blocked = await login(
      app,
      'leaky@example.com',
      'wrong password!!',
      'ip-secret-9',
    )
    expect(blocked.status).toBe(429)
    const everything = JSON.stringify({
      h: blocked.headers,
      b: blocked.body as object,
    })
    expect(everything).not.toContain('ip-secret-9')
    expect(everything).not.toContain('leaky@example.com')
  })
})

describe('the proxy pitfall (TRUST_PROXY)', () => {
  const forwarded = (app: Parameters<typeof request>[0], ip: string) =>
    post(request(app), '/api/auth/login', {
      email: 'x@example.com',
      password: 'wrong password!!',
    }).set('X-Forwarded-For', ip)

  it('with TRUST_PROXY=0 behind a proxy everyone shares ONE bucket (the proxy address)', async () => {
    const { app } = await authApp(db, {
      limits: { loginIp: { limit: 2 } },
      config: { trustProxy: 0 },
    })
    await forwarded(app, '203.0.113.1')
    await forwarded(app, '203.0.113.2')
    // A third, DIFFERENT client is blocked because the limiter only sees the proxy.
    expect((await forwarded(app, '203.0.113.3')).status).toBe(429)
  })

  it('with the right hop count each client gets its own bucket', async () => {
    const { app } = await authApp(db, {
      limits: { loginIp: { limit: 2 } },
      config: { trustProxy: 1 },
    })
    await forwarded(app, '203.0.113.1')
    await forwarded(app, '203.0.113.1')
    expect((await forwarded(app, '203.0.113.1')).status).toBe(429)
    expect((await forwarded(app, '203.0.113.2')).status).toBe(401)
  })

  it('IPv6 addresses in the same /56 share a bucket (no bypass by rotating the low bits)', async () => {
    const { app } = await authApp(db, {
      limits: { loginIp: { limit: 2 } },
      config: { trustProxy: 1 },
    })
    await forwarded(app, '2001:db8:abcd:1200::1')
    await forwarded(app, '2001:db8:abcd:1200::2')
    expect((await forwarded(app, '2001:db8:abcd:1200::ffff')).status).toBe(429)
    // A different /56 is a different client.
    expect((await forwarded(app, '2001:db8:abcd:3400::1')).status).toBe(401)
  })
})

describe('isolation', () => {
  it('each app instance starts with fresh counters', async () => {
    const first = await authApp(db, {
      limits: { loginAccount: { limit: 1 } },
      keys,
    })
    await login(first.app, 'a@example.com', 'wrong password!!')
    expect(
      (await login(first.app, 'a@example.com', 'wrong password!!')).status,
    ).toBe(429)
    const second = await authApp(db, {
      limits: { loginAccount: { limit: 1 } },
      keys,
    })
    expect(
      (await login(second.app, 'a@example.com', 'wrong password!!')).status,
    ).toBe(401)
  })
})
