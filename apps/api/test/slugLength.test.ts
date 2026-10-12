import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../src/db/client'
import { authApp, post } from './support/authApp'
import { useDatabase } from './support/db'
import { assertTestDatabase } from './support/guard'
import { join, organization, person } from './support/orgFixture'

// The 63-character slug cap over HTTP (ADR 0014 amendment). The database CHECK is
// proven separately in test/db/constraints.test.ts.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface Body {
  organization?: { slug: string }
  brand?: { slug: string }
  error?: {
    code: string
    message: string
    details?: { field?: string }
  }
}

const SLUG_63 = 'a'.repeat(63)
const SLUG_64 = 'a'.repeat(64)

describe('POST /api/orgs: slug length', () => {
  it('accepts a 63-character slug', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const response = await post(request(ctx.app), '/api/orgs', {
      name: 'Long',
      slug: SLUG_63,
    }).set('Cookie', me.cookie)
    expect(response.status).toBe(201)
    expect((response.body as Body).organization?.slug).toBe(SLUG_63)
  })

  it('rejects a 64-character slug with 400 and details.field = slug; nothing is written', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const response = await post(request(ctx.app), '/api/orgs', {
      name: 'Long',
      slug: SLUG_64,
    }).set('Cookie', me.cookie)
    expect(response.status).toBe(400)
    expect((response.body as Body).error?.details).toEqual({ field: 'slug' })
    expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(0)
  })

  it.each([
    ['a malformed slug', { name: 'Ok', slug: 'Not Valid' }, 'slug'],
    ['an empty name', { name: '   ', slug: 'ok' }, 'name'],
    ['an over-long name', { name: 'x'.repeat(201), slug: 'ok' }, 'name'],
  ])('names the field for %s', async (_label, body, field) => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const response = await post(request(ctx.app), '/api/orgs', body).set(
      'Cookie',
      me.cookie,
    )
    expect(response.status).toBe(400)
    expect((response.body as Body).error?.details).toEqual({ field })
  })
})

describe('POST /api/orgs/:orgId/brands: slug length', () => {
  async function team() {
    const ctx = await authApp(db)
    const org = await organization(pool, 'brand-team')
    const owner = await person(pool, ctx.sessions, 'owner@example.com')
    await join(pool, owner.id, org, 'OWNER')
    return { ...ctx, org, owner }
  }

  it('accepts a 63-character slug', async () => {
    const ctx = await team()
    const response = await post(
      request(ctx.app),
      `/api/orgs/${ctx.org}/brands`,
      { name: 'Long', slug: SLUG_63 },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(201)
    expect((response.body as Body).brand?.slug).toBe(SLUG_63)
  })

  it('rejects a 64-character slug with 400 and details.field = slug; nothing is written', async () => {
    const ctx = await team()
    const response = await post(
      request(ctx.app),
      `/api/orgs/${ctx.org}/brands`,
      { name: 'Long', slug: SLUG_64 },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(400)
    expect((response.body as Body).error?.details).toEqual({ field: 'slug' })
    expect((await pool.query('SELECT 1 FROM "Brand"')).rowCount).toBe(0)
  })

  it.each([
    ['a malformed slug', { name: 'Ok', slug: 'Not Valid' }, 'slug'],
    ['an empty name', { name: '   ', slug: 'ok' }, 'name'],
    ['an over-long name', { name: 'x'.repeat(201), slug: 'ok' }, 'name'],
  ])('names the field for %s', async (_label, body, field) => {
    const ctx = await team()
    const response = await post(
      request(ctx.app),
      `/api/orgs/${ctx.org}/brands`,
      body,
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(400)
    expect((response.body as Body).error?.details).toEqual({ field })
  })
})
