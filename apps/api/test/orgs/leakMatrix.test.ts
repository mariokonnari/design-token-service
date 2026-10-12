import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import type { RouteDef } from '../../src/routes/table'
import { authApp } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import { join, organization, person } from '../support/orgFixture'

// THE CROSS-TENANT LEAK MATRIX. It iterates the ROUTE TABLE: every org-scoped route
// is called as (a) a member of ANOTHER org, (b) an authenticated user with a random
// org id, (c) nobody. (a) and (b) must be the SAME 404, (c) must be 401.
// A route in the table without a case here FAILS the test, so a new org-scoped route
// cannot ship without being added to the matrix.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface Fixture {
  orgId: (variant: string) => string
  /** A real member of the TARGET organization, so a 404 cannot be explained by a missing target. */
  targetUserId: string
}

/** One entry per org-scoped route in the table: how to build its path and body. */
const MATRIX: Record<
  string,
  { path: (f: Fixture, orgId: string) => string; body?: unknown }
> = {
  'GET /api/orgs/:orgId/members': {
    path: (_f, orgId) => `/api/orgs/${orgId}/members`,
  },
  'PATCH /api/orgs/:orgId/members/:userId': {
    path: (f, orgId) => `/api/orgs/${orgId}/members/${f.targetUserId}`,
    body: { role: 'EDITOR' },
  },
  'DELETE /api/orgs/:orgId/members/:userId': {
    path: (f, orgId) => `/api/orgs/${orgId}/members/${f.targetUserId}`,
  },
}

const keyOf = (route: RouteDef) => `${route.method.toUpperCase()} ${route.path}`
const isOrgScoped = (route: RouteDef) => typeof route.access === 'object'

function call(
  app: Parameters<typeof request>[0],
  route: RouteDef,
  path: string,
  body: unknown,
  cookie?: string,
) {
  let test = request(app)[route.method](path).set('Origin', ALLOWED_ORIGIN)
  if (cookie !== undefined) test = test.set('Cookie', cookie)
  if (body !== undefined)
    test = test.set('Content-Type', 'application/json').send(body as object)
  return test
}

describe('the leak matrix', () => {
  it('has a matrix case for EVERY org-scoped route in the route table, and nothing stale', async () => {
    const { routes } = await authApp(db)
    const scoped = routes.filter(isOrgScoped).map(keyOf).sort()
    expect(scoped.length).toBeGreaterThanOrEqual(3) // not vacuous
    const missing = scoped.filter((key) => !(key in MATRIX))
    expect(
      missing,
      `org-scoped routes without a matrix case: ${missing.join(', ')}`,
    ).toEqual([])
    const stale = Object.keys(MATRIX).filter((key) => !scoped.includes(key))
    expect(
      stale,
      `matrix cases for routes that no longer exist: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('exercises every org-scoped route as (a) another org’s member, (b) a random org id and (c) nobody', async () => {
    const ctx = await authApp(db)
    const orgA = await organization(pool, 'victim-org')
    const orgB = await organization(pool, 'attacker-org')
    const victimOwner = await person(
      pool,
      ctx.sessions,
      'victim-owner@example.com',
    )
    const victimMember = await person(
      pool,
      ctx.sessions,
      'victim-member@example.com',
    )
    const attacker = await person(pool, ctx.sessions, 'attacker@example.com')
    await join(pool, victimOwner.id, orgA, 'OWNER')
    await join(pool, victimMember.id, orgA, 'EDITOR')
    await join(pool, attacker.id, orgB, 'OWNER') // an OWNER of their own org: power elsewhere is irrelevant
    const fixture: Fixture = {
      orgId: () => orgA,
      targetUserId: victimMember.id,
    }
    const random = '99999999-9999-4999-8999-999999999999'

    const scoped = ctx.routes.filter(isOrgScoped)
    const methods = new Set<string>()
    const exercisedMethods = new Set<string>()
    for (const route of scoped) methods.add(route.method)

    const before = await pool.query('SELECT * FROM "Membership" ORDER BY id')

    for (const route of scoped) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined)
        throw new Error(`no matrix case for ${keyOf(route)}`)
      const at = (orgId: string) => entry.path(fixture, orgId)

      // (a) a member of ANOTHER organization asks about the victim organization
      const a = await call(
        ctx.app,
        route,
        at(orgA),
        entry.body,
        attacker.cookie,
      )
      // (b) an authenticated user asks about an organization that does not exist
      const b = await call(
        ctx.app,
        route,
        at(random),
        entry.body,
        attacker.cookie,
      )
      // (b2) a malformed organization id
      const b2 = await call(
        ctx.app,
        route,
        at('not-a-uuid'),
        entry.body,
        attacker.cookie,
      )
      // (c) nobody is logged in
      const c = await call(ctx.app, route, at(orgA), entry.body)

      const label = keyOf(route)
      expect(a.status, `${label} (a)`).toBe(404)
      expect(b.status, `${label} (b)`).toBe(404)
      expect(b2.status, `${label} (b2)`).toBe(404)
      // Identical: the response cannot tell "exists but not yours" from "does not exist".
      expect(a.body, `${label} (a) vs (b)`).toEqual(b.body)
      expect(a.body, `${label} (a) vs (b2)`).toEqual(b2.body)
      expect(a.body, label).toEqual({
        error: { code: 'NOT_FOUND', message: 'Not found.' },
      })
      const headerNames = (r: request.Response) =>
        Object.keys(r.headers)
          .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
          .sort()
          .join(',')
      expect(headerNames(a), `${label} headers`).toBe(headerNames(b))
      expect(headerNames(a), `${label} headers`).toBe(headerNames(b2))

      expect(c.status, `${label} (c)`).toBe(401)
      expect(c.body, `${label} (c)`).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      })
      exercisedMethods.add(route.method)
    }

    // At least one org-scoped route per HTTP method present in the table was exercised.
    expect([...exercisedMethods].sort()).toEqual([...methods].sort())
    expect(exercisedMethods.has('get')).toBe(true)
    expect(exercisedMethods.has('patch')).toBe(true)
    expect(exercisedMethods.has('delete')).toBe(true)

    // And nothing was changed by any of those attempts.
    const after = await pool.query('SELECT * FROM "Membership" ORDER BY id')
    expect(after.rows).toEqual(before.rows)
  })

  it('sanity: the same calls DO work for a real member of the organization', async () => {
    const ctx = await authApp(db)
    const org = await organization(pool, 'real-org')
    const owner = await person(pool, ctx.sessions, 'real-owner@example.com')
    const member = await person(pool, ctx.sessions, 'real-member@example.com')
    await join(pool, owner.id, org, 'OWNER')
    await join(pool, member.id, org, 'VIEWER')
    const fixture: Fixture = { orgId: () => org, targetUserId: member.id }
    for (const route of ctx.routes.filter(isOrgScoped)) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined) throw new Error('no matrix case')
      const response = await call(
        ctx.app,
        route,
        entry.path(fixture, org),
        entry.body,
        owner.cookie,
      )
      expect([200, 204], keyOf(route)).toContain(response.status)
    }
  })
})
