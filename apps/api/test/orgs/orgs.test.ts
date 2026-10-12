import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { ConflictError } from '../../src/errors'
import { OrganizationRepository } from '../../src/repositories/global/organizations'
import { authApp, post } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import { ALLOWED_ORIGIN } from '../support/http'
import { join, organization, person, roleOf } from '../support/orgFixture'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface OrgBody {
  organization?: { id: string; slug: string; name: string; role: string }
  organizations?: { id: string; slug: string; name: string; role: string }[]
  error?: { code: string; message: string }
}

describe('POST /api/orgs', () => {
  it('creates the organization and makes the creator its OWNER', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const response = await post(request(ctx.app), '/api/orgs', {
      name: 'Acme Inc',
      slug: 'acme',
    }).set('Cookie', me.cookie)
    expect(response.status).toBe(201)
    const created = (response.body as OrgBody).organization
    expect(created).toMatchObject({
      slug: 'acme',
      name: 'Acme Inc',
      role: 'OWNER',
    })
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await roleOf(pool, String(created?.id), me.id)).toBe('OWNER')
    expect((await pool.query('SELECT 1 FROM "Membership"')).rowCount).toBe(1)
  })

  it('answers 409 SLUG_TAKEN for a duplicate slug and creates nothing extra', async () => {
    const ctx = await authApp(db)
    const a = await person(pool, ctx.sessions, 'a@example.com')
    const b = await person(pool, ctx.sessions, 'b@example.com')
    const first = await post(request(ctx.app), '/api/orgs', {
      name: 'One',
      slug: 'same',
    }).set('Cookie', a.cookie)
    expect(first.status).toBe(201)
    const second = await post(request(ctx.app), '/api/orgs', {
      name: 'Two',
      slug: 'same',
    }).set('Cookie', b.cookie)
    expect(second.status).toBe(409)
    expect((second.body as OrgBody).error?.code).toBe('SLUG_TAKEN')
    expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM "Membership"')).rowCount).toBe(1)
  })

  it('concurrent creations with one slug: exactly one wins, the rest are 409, never a 500', async () => {
    const ctx = await authApp(db)
    const people = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        person(pool, ctx.sessions, `p${i}@example.com`),
      ),
    )
    const responses = await Promise.all(
      people.map((p) =>
        post(request(ctx.app), '/api/orgs', { name: 'Race', slug: 'race' }).set(
          'Cookie',
          p.cookie,
        ),
      ),
    )
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1)
    expect(responses.filter((r) => r.status === 409)).toHaveLength(7)
    expect(responses.filter((r) => r.status >= 500)).toHaveLength(0)
    expect((await pool.query('SELECT 1 FROM "Membership"')).rowCount).toBe(1)
  })

  it.each(['', 'Acme', 'a_b', '-a', 'a b', 'a--b', 'x'.repeat(200) + '!'])(
    'rejects the invalid slug %j with 400',
    async (slug) => {
      const ctx = await authApp(db)
      const me = await person(pool, ctx.sessions, 'me@example.com')
      const response = await post(request(ctx.app), '/api/orgs', {
        name: 'Name',
        slug,
      }).set('Cookie', me.cookie)
      expect(response.status).toBe(400)
      expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(
        0,
      )
    },
  )

  it.each(['', '   ', 'x'.repeat(201), 5])(
    'rejects the invalid name %j with 400',
    async (name) => {
      const ctx = await authApp(db)
      const me = await person(pool, ctx.sessions, 'me@example.com')
      const response = await post(request(ctx.app), '/api/orgs', {
        name,
        slug: 'ok',
      }).set('Cookie', me.cookie)
      expect(response.status).toBe(400)
    },
  )

  it.each([
    ['role', { role: 'VIEWER' }],
    ['ownerId', { ownerId: '11111111-1111-4111-8111-111111111111' }],
    ['id', { id: '11111111-1111-4111-8111-111111111111' }],
    ['userId', { userId: '11111111-1111-4111-8111-111111111111' }],
    [
      'organizationId',
      { organizationId: '11111111-1111-4111-8111-111111111111' },
    ],
    ['memberships', { memberships: [] }],
  ])(
    'rejects an extra %s field with 400 and creates nothing',
    async (_name, extra) => {
      const ctx = await authApp(db)
      const me = await person(pool, ctx.sessions, 'me@example.com')
      const response = await post(request(ctx.app), '/api/orgs', {
        name: 'Acme',
        slug: 'acme',
        ...extra,
      }).set('Cookie', me.cookie)
      expect(response.status).toBe(400)
      expect((response.body as OrgBody).error?.code).toBe('VALIDATION_ERROR')
      expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(
        0,
      )
    },
  )

  it('trims the name', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const response = await post(request(ctx.app), '/api/orgs', {
      name: '  Spaced  ',
      slug: 'spaced',
    }).set('Cookie', me.cookie)
    expect((response.body as OrgBody).organization?.name).toBe('Spaced')
  })

  it('requires a session (401) and the Origin check (403)', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    expect(
      (await post(request(ctx.app), '/api/orgs', { name: 'A', slug: 'a' }))
        .status,
    ).toBe(401)
    const noOrigin = await request(ctx.app)
      .post('/api/orgs')
      .set('Cookie', me.cookie)
      .set('Content-Type', 'application/json')
      .send({ name: 'A', slug: 'a' })
    expect(noOrigin.status).toBe(403)
    const badOrigin = await request(ctx.app)
      .post('/api/orgs')
      .set('Cookie', me.cookie)
      .set('Origin', 'https://evil.example.test')
      .set('Content-Type', 'application/json')
      .send({ name: 'A', slug: 'a' })
    expect(badOrigin.status).toBe(403)
    expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(0)
    expect(ALLOWED_ORIGIN).toBeTruthy()
  })
})

describe('creation is atomic (one transaction)', () => {
  it('a failure while adding the owner leaves NO organization behind', async () => {
    const repo = new OrganizationRepository(db)
    // The owner does not exist: the membership insert violates its foreign key.
    await expect(
      repo.createWithOwner('00000000-0000-4000-8000-000000000000', {
        name: 'Ghost',
        slug: 'ghost',
      }),
    ).rejects.toThrow()
    expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(0)
  })

  it('maps a duplicate slug to ConflictError SLUG_TAKEN', async () => {
    const repo = new OrganizationRepository(db)
    const ctx = await authApp(db)
    const a = await person(pool, ctx.sessions, 'a@example.com')
    await repo.createWithOwner(a.id, { name: 'One', slug: 'dup' })
    const error = await repo
      .createWithOwner(a.id, { name: 'Two', slug: 'dup' })
      .then(
        () => undefined,
        (caught: unknown) => caught,
      )
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('SLUG_TAKEN')
  })
})

describe('GET /api/orgs', () => {
  it('lists only MY organizations with my role, ordered by slug', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const other = await person(pool, ctx.sessions, 'other@example.com')
    const zeta = await organization(pool, 'zeta')
    const alpha = await organization(pool, 'alpha')
    const hidden = await organization(pool, 'hidden')
    await join(pool, me.id, zeta, 'VIEWER')
    await join(pool, me.id, alpha, 'OWNER')
    await join(pool, other.id, hidden, 'OWNER')
    const response = await request(ctx.app)
      .get('/api/orgs')
      .set('Cookie', me.cookie)
    expect(response.status).toBe(200)
    expect((response.body as OrgBody).organizations).toEqual([
      { id: alpha, slug: 'alpha', name: 'ALPHA', role: 'OWNER' },
      { id: zeta, slug: 'zeta', name: 'ZETA', role: 'VIEWER' },
    ])
  })

  it('is an empty list for a user with none, and 401 without a session', async () => {
    const ctx = await authApp(db)
    const me = await person(pool, ctx.sessions, 'me@example.com')
    const empty = await request(ctx.app)
      .get('/api/orgs')
      .set('Cookie', me.cookie)
    expect((empty.body as OrgBody).organizations).toEqual([])
    expect((await request(ctx.app).get('/api/orgs')).status).toBe(401)
  })
})
