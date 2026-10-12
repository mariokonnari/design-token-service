import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import * as policy from '../../src/tenancy/policy'
import { authApp, patch, post } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { join, organization, person } from '../support/orgFixture'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface BrandBody {
  brand?: {
    id: string
    slug: string
    name: string
    visibility: string
    draftRevision: number
    organizationId?: string
  }
  brands?: { id: string; slug: string }[]
  error?: { code: string; message: string }
}

async function team() {
  const ctx = await authApp(db)
  const org = await organization(pool, 'brand-team')
  const owner = await person(pool, ctx.sessions, 'owner@example.com')
  const editor = await person(pool, ctx.sessions, 'editor@example.com')
  const viewer = await person(pool, ctx.sessions, 'viewer@example.com')
  await join(pool, owner.id, org, 'OWNER')
  await join(pool, editor.id, org, 'EDITOR')
  await join(pool, viewer.id, org, 'VIEWER')
  return { ...ctx, org, owner, editor, viewer }
}
type Team = Awaited<ReturnType<typeof team>>
const ROLES = ['owner', 'editor', 'viewer'] as const

const brandsUrl = (org: string, brandId = '') =>
  `/api/orgs/${org}/brands${brandId === '' ? '' : `/${brandId}`}`

async function createBrand(ctx: Team, slug = 'acme', name = 'Acme') {
  const response = await post(request(ctx.app), brandsUrl(ctx.org), {
    slug,
    name,
  }).set('Cookie', ctx.owner.cookie)
  expect(response.status).toBe(201)
  return (response.body as BrandBody).brand!
}

describe('POST /api/orgs/:orgId/brands', () => {
  it.each(['owner', 'editor'] as const)(
    'a %s can create a brand (201), draftRevision starts at 0, visibility PRIVATE',
    async (who) => {
      const ctx = await team()
      const response = await post(request(ctx.app), brandsUrl(ctx.org), {
        slug: 'acme',
        name: '  Acme  ',
      }).set('Cookie', ctx[who].cookie)
      expect(response.status).toBe(201)
      const brand = (response.body as BrandBody).brand
      expect(brand).toMatchObject({
        slug: 'acme',
        name: 'Acme',
        visibility: 'PRIVATE',
        draftRevision: 0,
      })
      const rows = await pool.query(
        'SELECT "organizationId" FROM "Brand" WHERE slug = $1',
        ['acme'],
      )
      expect(rows.rows).toEqual([{ organizationId: ctx.org }])
    },
  )

  it('a viewer gets 403 and nothing is written', async () => {
    const ctx = await team()
    const response = await post(request(ctx.app), brandsUrl(ctx.org), {
      slug: 'acme',
      name: 'Acme',
    }).set('Cookie', ctx.viewer.cookie)
    expect(response.status).toBe(403)
    expect((await pool.query('SELECT 1 FROM "Brand"')).rowCount).toBe(0)
  })

  it('a duplicate slug in the same organization is 409 CONFLICT', async () => {
    const ctx = await team()
    await createBrand(ctx)
    const response = await post(request(ctx.app), brandsUrl(ctx.org), {
      slug: 'acme',
      name: 'Other',
    }).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(409)
    expect((response.body as BrandBody).error?.code).toBe('CONFLICT')
  })

  it('the same slug in ANOTHER organization is fine', async () => {
    const ctx = await team()
    await createBrand(ctx)
    const other = await organization(pool, 'other-org')
    await join(pool, ctx.owner.id, other, 'OWNER')
    const response = await post(request(ctx.app), brandsUrl(other), {
      slug: 'acme',
      name: 'Acme',
    }).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(201)
  })

  it.each([
    [
      'unknown key organizationId',
      { slug: 'a', name: 'A', organizationId: 'x' },
    ],
    ['unknown key id', { slug: 'a', name: 'A', id: 'x' }],
    ['unknown key draftRevision', { slug: 'a', name: 'A', draftRevision: 9 }],
    ['unknown key visibility', { slug: 'a', name: 'A', visibility: 'PUBLIC' }],
    ['missing name', { slug: 'a' }],
    ['missing slug', { name: 'A' }],
    ['non-string name', { slug: 'a', name: 5 }],
    ['bad slug', { slug: 'Not Valid', name: 'A' }],
    ['empty name', { slug: 'a', name: '   ' }],
    ['over-long name', { slug: 'a', name: 'x'.repeat(201) }],
  ])('%s is 400 and nothing is written', async (_label, body) => {
    const ctx = await team()
    const response = await post(request(ctx.app), brandsUrl(ctx.org), body).set(
      'Cookie',
      ctx.owner.cookie,
    )
    expect(response.status).toBe(400)
    expect((await pool.query('SELECT 1 FROM "Brand"')).rowCount).toBe(0)
  })

  it('a __proto__ key is 400', async () => {
    const ctx = await team()
    const response = await request(ctx.app)
      .post(brandsUrl(ctx.org))
      .set('Origin', 'https://app.example.test')
      .set('Cookie', ctx.owner.cookie)
      .set('Content-Type', 'application/json')
      .send('{"slug":"a","name":"A","__proto__":{"x":1}}')
    expect(response.status).toBe(400)
  })
})

describe('GET /api/orgs/:orgId/brands[/:brandId]: any member', () => {
  it.each(ROLES)('a %s can list and read', async (who) => {
    const ctx = await team()
    const brand = await createBrand(ctx)
    await createBrand(ctx, 'beta', 'Beta')
    const list = await request(ctx.app)
      .get(brandsUrl(ctx.org))
      .set('Cookie', ctx[who].cookie)
    expect(list.status).toBe(200)
    expect((list.body as BrandBody).brands?.map((b) => b.slug)).toEqual([
      'acme',
      'beta',
    ])
    const one = await request(ctx.app)
      .get(brandsUrl(ctx.org, brand.id))
      .set('Cookie', ctx[who].cookie)
    expect(one.status).toBe(200)
    expect((one.body as BrandBody).brand?.id).toBe(brand.id)
  })

  it('lists only this organization’s brands', async () => {
    const ctx = await team()
    await createBrand(ctx)
    const other = await organization(pool, 'elsewhere')
    await pool.query(
      `INSERT INTO "Brand" ("organizationId", slug, name) VALUES ($1, 'secret', 'Secret')`,
      [other],
    )
    const list = await request(ctx.app)
      .get(brandsUrl(ctx.org))
      .set('Cookie', ctx.viewer.cookie)
    expect((list.body as BrandBody).brands?.map((b) => b.slug)).toEqual([
      'acme',
    ])
  })

  it('a malformed or unknown brand id is the same 404', async () => {
    const ctx = await team()
    const missing = await request(ctx.app)
      .get(brandsUrl(ctx.org, '99999999-9999-4999-8999-999999999999'))
      .set('Cookie', ctx.viewer.cookie)
    const malformed = await request(ctx.app)
      .get(brandsUrl(ctx.org, 'nope'))
      .set('Cookie', ctx.viewer.cookie)
    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(404)
    expect(missing.body).toEqual(malformed.body)
  })
})

describe('PATCH /api/orgs/:orgId/brands/:brandId: name = EDITOR+, visibility = OWNER only', () => {
  it.each(['owner', 'editor'] as const)('a %s can rename', async (who) => {
    const ctx = await team()
    const brand = await createBrand(ctx)
    const response = await patch(
      request(ctx.app),
      brandsUrl(ctx.org, brand.id),
      {
        name: 'Renamed',
      },
    ).set('Cookie', ctx[who].cookie)
    expect(response.status).toBe(200)
    expect((response.body as BrandBody).brand).toMatchObject({
      id: brand.id,
      name: 'Renamed',
      slug: 'acme',
      visibility: 'PRIVATE',
    })
  })

  it('a viewer cannot rename (403) and nothing changes', async () => {
    const ctx = await team()
    const brand = await createBrand(ctx)
    const response = await patch(
      request(ctx.app),
      brandsUrl(ctx.org, brand.id),
      {
        name: 'Renamed',
      },
    ).set('Cookie', ctx.viewer.cookie)
    expect(response.status).toBe(403)
    const row = await pool.query('SELECT name FROM "Brand" WHERE id = $1', [
      brand.id,
    ])
    expect(row.rows).toEqual([{ name: 'Acme' }])
  })

  it('an owner can change visibility', async () => {
    const ctx = await team()
    const brand = await createBrand(ctx)
    const response = await patch(
      request(ctx.app),
      brandsUrl(ctx.org, brand.id),
      {
        visibility: 'PUBLIC',
      },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(200)
    expect((response.body as BrandBody).brand?.visibility).toBe('PUBLIC')
  })

  it.each(['editor', 'viewer'] as const)(
    'a %s cannot change visibility (403), even together with a rename; NOTHING is applied',
    async (who) => {
      const ctx = await team()
      const brand = await createBrand(ctx)
      for (const body of [
        { visibility: 'PUBLIC' },
        { name: 'Sneaky', visibility: 'PUBLIC' },
      ]) {
        const response = await patch(
          request(ctx.app),
          brandsUrl(ctx.org, brand.id),
          body,
        ).set('Cookie', ctx[who].cookie)
        expect(response.status).toBe(403)
      }
      const row = await pool.query(
        'SELECT name, visibility FROM "Brand" WHERE id = $1',
        [brand.id],
      )
      expect(row.rows).toEqual([{ name: 'Acme', visibility: 'PRIVATE' }])
    },
  )

  it.each([
    ['empty body', {}],
    ['unknown key slug (slugs are immutable)', { slug: 'new-slug' }],
    ['unknown key draftRevision', { draftRevision: 5 }],
    ['unknown key organizationId', { name: 'A', organizationId: 'x' }],
    ['invalid visibility', { visibility: 'INTERNAL' }],
    ['empty name', { name: '' }],
    ['non-string name', { name: 7 }],
  ])('%s is 400', async (_label, body) => {
    const ctx = await team()
    const brand = await createBrand(ctx)
    const response = await patch(
      request(ctx.app),
      brandsUrl(ctx.org, brand.id),
      body,
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(400)
    const row = await pool.query(
      'SELECT slug, "draftRevision" FROM "Brand" WHERE id = $1',
      [brand.id],
    )
    expect(row.rows).toEqual([{ slug: 'acme', draftRevision: 0 }])
  })

  it('a malformed brand id is 404, not 400', async () => {
    const ctx = await team()
    const response = await patch(request(ctx.app), brandsUrl(ctx.org, 'nope'), {
      name: 'x',
    }).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(404)
  })
})

describe('there is NO brand delete in v1', () => {
  it('DELETE /brands/:brandId is not in the route table (releases are RESTRICT)', async () => {
    const ctx = await team()
    expect(
      ctx.routes.filter(
        (r) =>
          r.method === 'delete' &&
          r.path === '/api/orgs/:orgId/brands/:brandId',
      ),
    ).toEqual([])
  })
})

describe('routes narrowed by `refinedBy`: PATCH brand', () => {
  it('names a real policy function and the roles behave as the policy says', async () => {
    const ctx = await team()
    const route = ctx.routes.find(
      (r) =>
        r.method === 'patch' && r.path === '/api/orgs/:orgId/brands/:brandId',
    )
    expect(route?.refinedBy).toBe('canChangeVisibility')
    expect(
      typeof (policy as Record<string, unknown>)['canChangeVisibility'],
    ).toBe('function')
    expect(route?.access).toEqual({ orgRole: 'EDITOR' })
  })
})
