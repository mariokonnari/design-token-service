import { createHash } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import type { RouteDef } from '../../src/routes/table'
import { authApp } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import { join, organization, person } from '../support/orgFixture'
import { makeBrand, makeRelease, makeToken } from '../db/helpers'

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
  /** A real brand of the TARGET organization, with one token at `tokenPath` (version 1). */
  brandId: string
  tokenPath: string
}

const TOKEN_PATH = 'semantic.color.action'
const COLOR = { colorSpace: 'srgb', components: [0, 0, 0] }

/** One entry per org-scoped route in the table: how to build its path and body. */
const MATRIX: Record<
  string,
  {
    path: (
      f: Fixture,
      orgId: string,
      brandId: string,
      releaseNumber?: number,
    ) => string
    /** A route with `:number`: it MUST get the foreign-release-number cases (see below). */
    release?: true
    /** A body, or a function of the live draftRevision (the import needs the current one). */
    body?: unknown
    /** Statuses a legitimate owner may get (the sanity test). Default: 200 or 204. */
    ok?: number[]
  }
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
  'POST /api/orgs/:orgId/brands': {
    path: (_f, orgId) => `/api/orgs/${orgId}/brands`,
    body: { name: 'Matrix', slug: 'matrix' },
    ok: [201],
  },
  'GET /api/orgs/:orgId/brands': {
    path: (_f, orgId) => `/api/orgs/${orgId}/brands`,
  },
  'GET /api/orgs/:orgId/brands/:brandId': {
    path: (_f, orgId, brandId) => `/api/orgs/${orgId}/brands/${brandId}`,
  },
  'PATCH /api/orgs/:orgId/brands/:brandId': {
    path: (_f, orgId, brandId) => `/api/orgs/${orgId}/brands/${brandId}`,
    body: { name: 'Renamed' },
  },
  'GET /api/orgs/:orgId/brands/:brandId/tokens': {
    path: (_f, orgId, brandId) => `/api/orgs/${orgId}/brands/${brandId}/tokens`,
  },
  // The sanity run calls routes in ROUTE-TABLE order. The import is registered after
  // PUT and DELETE, because it replaces the draft (the seeded token would be gone).
  'POST /api/orgs/:orgId/brands/:brandId/tokens/import': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/tokens/import`,
    body: (live: { revision: number }) => ({
      // (a semantic token too: the releases routes that follow need an exportable draft)
      tree: {
        primitive: { n: { one: { $type: 'number', $value: 1 } } },
        semantic: { n: { one: { $type: 'number', $value: 1 } } },
      },
      expectedRevision: live.revision,
    }),
  },
  'GET /api/orgs/:orgId/brands/:brandId/validate': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/validate`,
  },
  'GET /api/orgs/:orgId/brands/:brandId/tokens/tree': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/tokens/tree`,
  },
  // Creates a DIFFERENT path, so the seeded token stays at version 1 for the DELETE below.
  'PUT /api/orgs/:orgId/brands/:brandId/tokens/:path': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/tokens/semantic.color.fresh`,
    body: { type: 'number', value: 1 },
    ok: [201],
  },
  'DELETE /api/orgs/:orgId/brands/:brandId/tokens/:path': {
    path: (f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/tokens/${f.tokenPath}?expectedVersion=1`,
  },
  // Releases (ADR 0015). Registered after the token routes, so the draft is the
  // imported one (exportable) when the sanity run reaches it.
  'POST /api/orgs/:orgId/brands/:brandId/releases': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/releases`,
    body: (live: { revision: number }) => ({ expectedRevision: live.revision }),
    ok: [201],
  },
  'GET /api/orgs/:orgId/brands/:brandId/releases': {
    path: (_f, orgId, brandId) =>
      `/api/orgs/${orgId}/brands/${brandId}/releases`,
  },
  'GET /api/orgs/:orgId/brands/:brandId/releases/:number': {
    path: (_f, orgId, brandId, n = 1) =>
      `/api/orgs/${orgId}/brands/${brandId}/releases/${n}`,
    release: true,
  },
  'GET /api/orgs/:orgId/brands/:brandId/releases/:number/css': {
    path: (_f, orgId, brandId, n = 1) =>
      `/api/orgs/${orgId}/brands/${brandId}/releases/${n}/css`,
    release: true,
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
  if (body !== undefined) {
    const resolved =
      typeof body === 'function'
        ? (body as (live: { revision: number }) => unknown)({ revision: 0 })
        : body
    test = test.set('Content-Type', 'application/json').send(resolved as object)
  }
  return test
}

describe('the leak matrix', () => {
  it('has a matrix case for EVERY org-scoped route in the route table, and nothing stale', async () => {
    const { routes } = await authApp(db)
    const scoped = routes.filter(isOrgScoped).map(keyOf).sort()
    expect(scoped.length).toBeGreaterThanOrEqual(7) // not vacuous
    const missing = scoped.filter((key) => !(key in MATRIX))
    expect(
      missing,
      `org-scoped routes without a matrix case: ${missing.join(', ')}`,
    ).toEqual([])
    // every route with a release number in its path needs the foreign-release cases
    const numbered = routes
      .filter(isOrgScoped)
      .filter((route) => route.path.includes(':number'))
      .map(keyOf)
    expect(numbered.length).toBeGreaterThanOrEqual(2) // not vacuous
    const unflagged = numbered.filter((key) => MATRIX[key]?.release !== true)
    expect(
      unflagged,
      `routes with :number but no release flag in the matrix: ${unflagged.join(', ')}`,
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
    const brandA = String(
      (await makeBrand(pool, { organizationId: orgA }))['id'],
    )
    await makeToken(pool, { brandId: brandA, path: TOKEN_PATH, value: COLOR })
    const fixture: Fixture = {
      orgId: () => orgA,
      targetUserId: victimMember.id,
      brandId: brandA,
      tokenPath: TOKEN_PATH,
    }
    const random = '99999999-9999-4999-8999-999999999999'

    const scoped = ctx.routes.filter(isOrgScoped)
    const methods = new Set<string>()
    const exercisedMethods = new Set<string>()
    for (const route of scoped) methods.add(route.method)

    const snapshot = async () => ({
      memberships: (await pool.query('SELECT * FROM "Membership" ORDER BY id'))
        .rows,
      brands: (await pool.query('SELECT * FROM "Brand" ORDER BY id')).rows,
      tokens: (await pool.query('SELECT * FROM "Token" ORDER BY id')).rows,
    })
    const before = await snapshot()

    for (const route of scoped) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined)
        throw new Error(`no matrix case for ${keyOf(route)}`)
      const at = (orgId: string, brandId = fixture.brandId) =>
        entry.path(fixture, orgId, brandId)

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
    expect(await snapshot()).toEqual(before)
  })

  it('WRONG PARENT: a member of BOTH org A and org B asking for A’s brand through B’s URL gets the same 404 as any miss', async () => {
    const ctx = await authApp(db)
    const orgA = await organization(pool, 'parent-a')
    const orgB = await organization(pool, 'parent-b')
    const dual = await person(pool, ctx.sessions, 'dual@example.com')
    const other = await person(pool, ctx.sessions, 'other-a@example.com')
    await join(pool, dual.id, orgA, 'OWNER')
    await join(pool, dual.id, orgB, 'OWNER') // full power in BOTH orgs: only the parent is wrong
    await join(pool, other.id, orgA, 'EDITOR')
    const brandA = String(
      (await makeBrand(pool, { organizationId: orgA }))['id'],
    )
    await makeToken(pool, { brandId: brandA, path: TOKEN_PATH, value: COLOR })
    const fixture: Fixture = {
      orgId: () => orgA,
      targetUserId: other.id,
      brandId: brandA,
      tokenPath: TOKEN_PATH,
    }
    const random = '99999999-9999-4999-8999-999999999999'
    const headerNames = (r: request.Response) =>
      Object.keys(r.headers)
        .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
        .sort()
        .join(',')
    const snapshot = async () => ({
      brands: (await pool.query('SELECT * FROM "Brand" ORDER BY id')).rows,
      tokens: (await pool.query('SELECT * FROM "Token" ORDER BY id')).rows,
    })
    const before = await snapshot()

    const brandRoutes = ctx.routes
      .filter(isOrgScoped)
      .filter((route) => route.path.includes(':brandId'))
    expect(brandRoutes.length).toBeGreaterThanOrEqual(2) // not vacuous
    for (const route of brandRoutes) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined)
        throw new Error(`no matrix case for ${keyOf(route)}`)
      const label = keyOf(route)
      // The case must really put the brand id in the URL, or it proves nothing.
      expect(entry.path(fixture, orgB, 'BRAND-MARKER'), label).toContain(
        'BRAND-MARKER',
      )
      const wrong = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, brandA),
        entry.body,
        dual.cookie,
      )
      const miss = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, random),
        entry.body,
        dual.cookie,
      )
      const malformed = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, 'not-a-uuid'),
        entry.body,
        dual.cookie,
      )
      expect(wrong.status, `${label} wrong parent`).toBe(404)
      expect(wrong.body, label).toEqual(miss.body)
      expect(wrong.body, label).toEqual(malformed.body)
      expect(wrong.body, label).toEqual({
        error: { code: 'NOT_FOUND', message: 'Not found.' },
      })
      expect(headerNames(wrong), label).toBe(headerNames(miss))
    }
    expect(await snapshot()).toEqual(before)
  })

  it('FOREIGN TOKEN PATH: a path that exists only in org A’s brand, asked through org B’s own brand, answers like any other miss and touches nothing', async () => {
    const ctx = await authApp(db)
    const orgA = await organization(pool, 'path-a')
    const orgB = await organization(pool, 'path-b')
    const dual = await person(pool, ctx.sessions, 'dual-path@example.com')
    await join(pool, dual.id, orgA, 'OWNER')
    await join(pool, dual.id, orgB, 'OWNER')
    const brandA = String(
      (await makeBrand(pool, { organizationId: orgA }))['id'],
    )
    const brandB = String(
      (await makeBrand(pool, { organizationId: orgB }))['id'],
    )
    await makeToken(pool, { brandId: brandA, path: TOKEN_PATH, value: COLOR })
    const base = `/api/orgs/${orgB}/brands/${brandB}/tokens`
    const snapshot = async () => ({
      brands: (await pool.query('SELECT * FROM "Brand" ORDER BY id')).rows,
      tokens: (await pool.query('SELECT * FROM "Token" ORDER BY id')).rows,
    })
    const before = await snapshot()
    const send = (
      method: 'put' | 'delete' | 'get',
      path: string,
      body?: unknown,
    ) => {
      const agent = request(ctx.app)
      let test = agent[method](path)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', dual.cookie)
      if (body !== undefined)
        test = test.set('Content-Type', 'application/json').send(body as object)
      return test
    }

    // DELETE: the foreign path and an invented path give the same 404 (no existence oracle)
    const del1 = await send('delete', `${base}/${TOKEN_PATH}?expectedVersion=1`)
    const del2 = await send(
      'delete',
      `${base}/semantic.color.invented?expectedVersion=1`,
    )
    expect(del1.status).toBe(404)
    expect(del1.body).toEqual(del2.body)

    // PUT-as-update: same 409 as for an invented path (and nothing is created)
    const put1 = await send('put', `${base}/${TOKEN_PATH}`, {
      type: 'number',
      value: 1,
      expectedVersion: 1,
    })
    const put2 = await send('put', `${base}/semantic.color.invented`, {
      type: 'number',
      value: 1,
      expectedVersion: 1,
    })
    expect(put1.status).toBe(409)
    expect(put1.body).toEqual(put2.body)

    // and B's reads never show A's token
    const list = await send('get', base)
    expect((list.body as { tokens: unknown[] }).tokens).toEqual([])
    expect(await snapshot()).toEqual(before)
  })

  it('FOREIGN RELEASE NUMBER: release 1 exists in two brands of two organizations; every :number route answers the foreign one like any miss, and each brand only ever returns its own', async () => {
    const ctx = await authApp(db)
    const orgA = await organization(pool, 'release-a')
    const orgB = await organization(pool, 'release-b')
    const dual = await person(pool, ctx.sessions, 'dual-release@example.com')
    const onlyB = await person(pool, ctx.sessions, 'only-b@example.com')
    await join(pool, dual.id, orgA, 'OWNER')
    await join(pool, dual.id, orgB, 'OWNER') // full power in BOTH: only the parent is wrong
    await join(pool, onlyB.id, orgB, 'OWNER')
    const brandA = String(
      (await makeBrand(pool, { organizationId: orgA }))['id'],
    )
    const brandB = String(
      (await makeBrand(pool, { organizationId: orgB }))['id'],
    )
    const release = (brandId: string, marker: string) =>
      makeRelease(pool, {
        brandId,
        number: 1,
        snapshot: { marker },
        note: marker,
        css: `/* ${marker} */
`,
        cssSha256: createHash('sha256')
          .update(
            `/* ${marker} */
`,
          )
          .digest('hex'),
      })
    await release(brandA, 'content of brand A')
    await release(brandB, 'content of brand B')
    const fixture: Fixture = {
      orgId: () => orgA,
      targetUserId: dual.id,
      brandId: brandA,
      tokenPath: TOKEN_PATH,
    }
    const headerNames = (r: request.Response) =>
      Object.keys(r.headers)
        .filter((h) => !['x-request-id', 'date', 'etag'].includes(h))
        .sort()
        .join(',')
    const before = (await pool.query('SELECT * FROM "Release" ORDER BY id'))
      .rows

    const routes = ctx.routes
      .filter(isOrgScoped)
      .filter((route) => route.path.includes(':number'))
    expect(routes.length).toBeGreaterThanOrEqual(2) // not vacuous
    for (const route of routes) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined)
        throw new Error(`no matrix case for ${keyOf(route)}`)
      const label = keyOf(route)
      // the number really is in the URL, or the case proves nothing
      expect(entry.path(fixture, orgB, brandB, 4242), label).toContain('4242')

      const own = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, brandB, 1),
        undefined,
        dual.cookie,
      )
      const miss = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, brandB, 999),
        undefined,
        dual.cookie,
      )
      // brand A's release 1, asked through ORG B's URL (wrong parent), even by a member of both
      const wrongParent = await call(
        ctx.app,
        route,
        entry.path(fixture, orgB, brandA, 1),
        undefined,
        dual.cookie,
      )
      // a member of B only, asking for A's release through A's URL
      const outsider = await call(
        ctx.app,
        route,
        entry.path(fixture, orgA, brandA, 1),
        undefined,
        onlyB.cookie,
      )

      expect(own.status, `${label} own`).toBe(200)
      const text = JSON.stringify(own.body) + own.text
      expect(text, `${label} returns B's own release`).not.toContain('brand A')
      expect(text, label).toContain('brand B')
      for (const r of [miss, wrongParent, outsider]) {
        expect(r.status, label).toBe(404)
        expect(r.body, label).toEqual({
          error: { code: 'NOT_FOUND', message: 'Not found.' },
        })
        expect(headerNames(r), label).toBe(headerNames(miss))
      }
      expect(JSON.stringify(wrongParent.body) + wrongParent.text).not.toContain(
        'brand A',
      )
    }
    expect(
      (await pool.query('SELECT * FROM "Release" ORDER BY id')).rows,
    ).toEqual(before)
  })

  it('sanity: the same calls DO work for a real member of the organization', async () => {
    const ctx = await authApp(db)
    const org = await organization(pool, 'real-org')
    const owner = await person(pool, ctx.sessions, 'real-owner@example.com')
    const member = await person(pool, ctx.sessions, 'real-member@example.com')
    await join(pool, owner.id, org, 'OWNER')
    await join(pool, member.id, org, 'VIEWER')
    const brand = String((await makeBrand(pool, { organizationId: org }))['id'])
    await makeToken(pool, { brandId: brand, path: TOKEN_PATH, value: COLOR })
    const fixture: Fixture = {
      orgId: () => org,
      targetUserId: member.id,
      brandId: brand,
      tokenPath: TOKEN_PATH,
    }
    for (const route of ctx.routes.filter(isOrgScoped)) {
      const entry = MATRIX[keyOf(route)]
      if (entry === undefined) throw new Error('no matrix case')
      const revisionRow = await pool.query<{ draftRevision: number }>(
        'SELECT "draftRevision" FROM "Brand" WHERE id = $1',
        [brand],
      )
      const live = { revision: revisionRow.rows[0]?.draftRevision ?? 0 }
      const response = await call(
        ctx.app,
        route,
        entry.path(fixture, org, brand),
        typeof entry.body === 'function'
          ? (entry.body as (l: { revision: number }) => unknown)(live)
          : entry.body,
        owner.cookie,
      )
      expect(entry.ok ?? [200, 204], keyOf(route)).toContain(response.status)
    }
  })
})
