import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getScope } from '../../src/auth/requireOrg'
import { createPrismaClient } from '../../src/db/client'
import { isTenantScope } from '../../src/tenancy/scope'
import { authApp, setCookies } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { join, organization, person } from '../support/orgFixture'
import { testRoute } from '../support/http'

// requireOrg is THE ONLY caller of issueTenantScope. A user who is not a member and an
// organization that does not exist must be INDISTINGUISHABLE.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const ping = (minimum: 'VIEWER' | 'EDITOR' | 'OWNER') =>
  testRoute(
    'get',
    `/t/orgs/:orgId/${minimum.toLowerCase()}`,
    (_req, res) => {
      const scope = getScope(res)
      res.json({
        organizationId: scope.organizationId,
        userId: scope.userId,
        role: scope.role,
        real: isTenantScope(scope),
      })
    },
    { access: { orgRole: minimum } },
  )

async function setup() {
  const ctx = await authApp(db, {
    extraRoutes: [ping('VIEWER'), ping('EDITOR'), ping('OWNER')],
  })
  const orgA = await organization(pool, 'org-a')
  const orgB = await organization(pool, 'org-b')
  const owner = await person(pool, ctx.sessions, 'owner@example.com')
  const editor = await person(pool, ctx.sessions, 'editor@example.com')
  const viewer = await person(pool, ctx.sessions, 'viewer@example.com')
  const outsider = await person(pool, ctx.sessions, 'outsider@example.com')
  await join(pool, owner.id, orgA, 'OWNER')
  await join(pool, editor.id, orgA, 'EDITOR')
  await join(pool, viewer.id, orgA, 'VIEWER')
  await join(pool, outsider.id, orgB, 'OWNER')
  return { ...ctx, orgA, orgB, owner, editor, viewer, outsider }
}

interface Body {
  error?: { code: string; message: string }
}
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Not found.' } }

describe('requireOrg: members get a real scope built from the DATABASE, not the request', () => {
  it('issues a real TenantScope with the stored role', async () => {
    const { app, orgA, editor } = await setup()
    const response = await request(app)
      .get(`/t/orgs/${orgA}/viewer`)
      .set('Cookie', editor.cookie)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      organizationId: orgA,
      userId: editor.id,
      role: 'EDITOR',
      real: true,
    })
  })

  it('ignores any role or organization the client tries to supply', async () => {
    const { app, orgA, orgB, viewer } = await setup()
    const response = await request(app)
      .get(`/t/orgs/${orgA}/viewer?role=OWNER&organizationId=${orgB}`)
      .set('Cookie', viewer.cookie)
      .set('X-Role', 'OWNER')
      .set('X-Organization-Id', orgB)
    expect(response.body).toMatchObject({
      organizationId: orgA,
      role: 'VIEWER',
    })
  })
})

describe('requireOrg: insufficient role in an organization you belong to is 403', () => {
  const cases: [
    string,
    'VIEWER' | 'EDITOR' | 'OWNER',
    'owner' | 'editor' | 'viewer',
    number,
  ][] = [
    ['VIEWER route, viewer', 'VIEWER', 'viewer', 200],
    ['EDITOR route, viewer', 'EDITOR', 'viewer', 403],
    ['OWNER route, viewer', 'OWNER', 'viewer', 403],
    ['VIEWER route, editor', 'VIEWER', 'editor', 200],
    ['EDITOR route, editor', 'EDITOR', 'editor', 200],
    ['OWNER route, editor', 'OWNER', 'editor', 403],
    ['VIEWER route, owner', 'VIEWER', 'owner', 200],
    ['EDITOR route, owner', 'EDITOR', 'owner', 200],
    ['OWNER route, owner', 'OWNER', 'owner', 200],
  ]
  it.each(cases)('%s', async (_name, minimum, who, status) => {
    const ctx = await setup()
    const response = await request(ctx.app)
      .get(`/t/orgs/${ctx.orgA}/${minimum.toLowerCase()}`)
      .set('Cookie', ctx[who].cookie)
    expect(response.status).toBe(status)
    if (status === 403) {
      expect((response.body as Body).error?.code).toBe('FORBIDDEN')
    }
  })
})

describe('requireOrg: not a member, no such organization and a malformed id are the same 404', () => {
  it('returns an identical status, body and header names for all three', async () => {
    const { app, orgA, outsider } = await setup()
    const random = '99999999-9999-4999-8999-999999999999'
    const responses = await Promise.all([
      request(app).get(`/t/orgs/${orgA}/viewer`).set('Cookie', outsider.cookie), // exists, not a member
      request(app)
        .get(`/t/orgs/${random}/viewer`)
        .set('Cookie', outsider.cookie), // does not exist
      request(app)
        .get('/t/orgs/not-a-uuid/viewer')
        .set('Cookie', outsider.cookie), // malformed
      request(app)
        .get(`/t/orgs/${random.toUpperCase()}/viewer`)
        .set('Cookie', outsider.cookie),
      request(app)
        .get(`/t/orgs/${orgA.slice(0, 35)}/viewer`)
        .set('Cookie', outsider.cookie),
    ])
    for (const response of responses) {
      expect(response.status).toBe(404)
      expect(response.body).toEqual(NOT_FOUND)
    }
    const shape = (r: request.Response) =>
      Object.keys(r.headers)
        .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
        .sort()
        .join(',')
    expect(new Set(responses.map(shape)).size).toBe(1)
  })

  it('is 404 for a non-member even when the route needs a higher role (no 403 oracle)', async () => {
    const { app, orgA, outsider } = await setup()
    const response = await request(app)
      .get(`/t/orgs/${orgA}/owner`)
      .set('Cookie', outsider.cookie)
    expect(response.status).toBe(404)
    expect(response.body).toEqual(NOT_FOUND)
  })

  it('does one membership lookup for a non-member and for a missing org (the same code path)', async () => {
    const ctx = await authApp(db, { extraRoutes: [ping('VIEWER')] })
    const outsider = await person(pool, ctx.sessions, 'o@example.com')
    const orgA = await organization(pool, 'only-a')
    let calls = 0
    const original = ctx.memberships.findMembership.bind(ctx.memberships)
    ctx.memberships.findMembership = (userId, organizationId) => {
      calls += 1
      return original(userId, organizationId)
    }
    await request(ctx.app)
      .get(`/t/orgs/${orgA}/viewer`)
      .set('Cookie', outsider.cookie)
    const forExisting = calls
    calls = 0
    await request(ctx.app)
      .get('/t/orgs/99999999-9999-4999-8999-999999999999/viewer')
      .set('Cookie', outsider.cookie)
    expect(forExisting).toBe(1)
    expect(calls).toBe(1)
  })

  it('does not even query for a malformed id', async () => {
    const ctx = await authApp(db, { extraRoutes: [ping('VIEWER')] })
    const outsider = await person(pool, ctx.sessions, 'o@example.com')
    let calls = 0
    const original = ctx.memberships.findMembership.bind(ctx.memberships)
    ctx.memberships.findMembership = (userId, organizationId) => {
      calls += 1
      return original(userId, organizationId)
    }
    await request(ctx.app)
      .get('/t/orgs/not-a-uuid/viewer')
      .set('Cookie', outsider.cookie)
    expect(calls).toBe(0)
  })
})

describe('requireOrg runs after authenticate', () => {
  it('is 401 (not 404) without a session, and clears the cookie', async () => {
    const { app, orgA } = await setup()
    const response = await request(app).get(`/t/orgs/${orgA}/viewer`)
    expect(response.status).toBe(401)
    expect(setCookies(response)[0]).toMatch(/^dts_session=;/)
  })

  it('a revoked session is 401 for an org route too', async () => {
    const { app, orgA, owner } = await setup()
    await pool.query('UPDATE "User" SET "sessionVersion" = 1 WHERE id = $1', [
      owner.id,
    ])
    const response = await request(app)
      .get(`/t/orgs/${orgA}/viewer`)
      .set('Cookie', owner.cookie)
    expect(response.status).toBe(401)
  })
})

describe('getScope', () => {
  it('throws if a handler asks for the scope on a route that did not run requireOrg', () => {
    expect(() => getScope({ locals: {} } as never)).toThrow(/requireOrg/)
  })
})
