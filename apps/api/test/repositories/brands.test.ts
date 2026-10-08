import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../src/errors'
import { BrandRepository } from '../../src/repositories/brands'
import {
  issueTenantScope,
  type Role,
  type TenantScope,
} from '../../src/tenancy/scope'
import { insert, makeBrand, makeOrg, makeUser } from '../db/helpers'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'

// Real Postgres, real Prisma client. The scopes here are issued with
// issueTenantScope exactly as the future auth middleware will issue them.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))
const brands = new BrandRepository(db)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

async function tenant(role: Role = 'OWNER') {
  const org = await makeOrg(pool)
  const user = await makeUser(pool)
  await insert(pool, 'Membership', {
    userId: user['id'],
    organizationId: org['id'],
    role,
  })
  const scope = issueTenantScope({
    organizationId: String(org['id']),
    userId: String(user['id']),
    role,
  })
  return { org, user, scope }
}

const rowCount = async () =>
  (await pool.query('SELECT 1 FROM "Brand"')).rowCount

describe('BrandRepository.create', () => {
  it("creates a PRIVATE brand in the scope's organization with the column defaults", async () => {
    const { org, scope } = await tenant('OWNER')
    const brand = await brands.create(scope, { slug: 'acme', name: 'Acme' })
    expect(brand).toMatchObject({
      organizationId: org['id'],
      slug: 'acme',
      name: 'Acme',
      visibility: 'PRIVATE',
      draftRevision: 0,
    })
    expect(brand.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(brand.createdAt).toBeInstanceOf(Date)
  })

  it("always uses the scope's organization, even if the caller smuggles another one in", async () => {
    const mine = await tenant('EDITOR')
    const other = await tenant('OWNER')
    const brand = await brands.create(mine.scope, {
      slug: 'x',
      name: 'X',
      organizationId: other.org['id'],
    } as never)
    expect(brand.organizationId).toBe(mine.org['id'])
    expect(await brands.list(other.scope)).toEqual([])
  })

  it.each(['OWNER', 'EDITOR'] as const)('allows the %s role', async (role) => {
    const { scope } = await tenant(role)
    await expect(
      brands.create(scope, { slug: 'ok', name: 'Ok' }),
    ).resolves.toBeTruthy()
  })

  it('refuses a VIEWER with ForbiddenError and writes nothing', async () => {
    const { scope } = await tenant('VIEWER')
    await expect(
      brands.create(scope, { slug: 'nope', name: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(await rowCount()).toBe(0)
  })

  it('maps a duplicate slug in the same organization to ConflictError', async () => {
    const { scope } = await tenant('OWNER')
    await brands.create(scope, { slug: 'main', name: 'Main' })
    await expect(
      brands.create(scope, { slug: 'main', name: 'Again' }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(await rowCount()).toBe(1)
  })

  it('allows the same slug in another organization', async () => {
    const a = await tenant('OWNER')
    const b = await tenant('OWNER')
    await brands.create(a.scope, { slug: 'main', name: 'A' })
    await expect(
      brands.create(b.scope, { slug: 'main', name: 'B' }),
    ).resolves.toBeTruthy()
  })

  it.each(['', 'Acme', 'a_b', '-a', 'a b', 'a--b'])(
    'rejects the invalid slug %j with ValidationError before touching the database',
    async (slug) => {
      const { scope } = await tenant('OWNER')
      await expect(
        brands.create(scope, { slug, name: 'N' }),
      ).rejects.toBeInstanceOf(ValidationError)
      expect(await rowCount()).toBe(0)
    },
  )

  it.each(['', '   ', 'x'.repeat(201)])(
    'rejects the invalid name %j',
    async (name) => {
      const { scope } = await tenant('OWNER')
      await expect(
        brands.create(scope, { slug: 'ok', name }),
      ).rejects.toBeInstanceOf(ValidationError)
    },
  )
})

describe('BrandRepository.list', () => {
  it("lists only the scope's own brands, ordered by slug", async () => {
    const a = await tenant('VIEWER')
    await makeBrand(pool, { organizationId: a.org['id'], slug: 'zeta' })
    await makeBrand(pool, { organizationId: a.org['id'], slug: 'alpha' })
    await makeBrand(pool, { organizationId: a.org['id'], slug: 'mid' })
    const listed = await brands.list(a.scope)
    expect(listed.map((b) => b.slug)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('returns an empty list for an organization with no brands', async () => {
    const { scope } = await tenant('OWNER')
    expect(await brands.list(scope)).toEqual([])
  })

  it('CROSS-TENANT: each organization sees only its own brands', async () => {
    const a = await tenant('OWNER')
    const b = await tenant('OWNER')
    await makeBrand(pool, { organizationId: a.org['id'], slug: 'a-brand' })
    await makeBrand(pool, { organizationId: b.org['id'], slug: 'b-brand' })
    expect((await brands.list(a.scope)).map((x) => x.slug)).toEqual(['a-brand'])
    expect((await brands.list(b.scope)).map((x) => x.slug)).toEqual(['b-brand'])
  })
})

describe('BrandRepository.get', () => {
  it('returns the brand for its own organization', async () => {
    const { org, scope } = await tenant('VIEWER')
    const made = await makeBrand(pool, {
      organizationId: org['id'],
      slug: 'mine',
    })
    const found = await brands.get(scope, String(made['id']))
    expect(found).toMatchObject({ id: made['id'], slug: 'mine' })
  })

  it("CROSS-TENANT: org B's scope reading org A's brand id returns null", async () => {
    const a = await tenant('OWNER')
    const b = await tenant('OWNER')
    const brandOfA = await makeBrand(pool, { organizationId: a.org['id'] })
    // The row exists and org A can read it ...
    expect(await brands.get(a.scope, String(brandOfA['id']))).not.toBeNull()
    // ... but org B gets nothing: indistinguishable from "does not exist".
    expect(await brands.get(b.scope, String(brandOfA['id']))).toBeNull()
  })

  it('returns null for a well-formed id that does not exist', async () => {
    const { scope } = await tenant('OWNER')
    expect(
      await brands.get(scope, '00000000-0000-4000-8000-000000000000'),
    ).toBeNull()
  })

  it('accepts an uppercase uuid for the same row', async () => {
    const { org, scope } = await tenant('OWNER')
    const made = await makeBrand(pool, { organizationId: org['id'] })
    expect(
      await brands.get(scope, String(made['id']).toUpperCase()),
    ).not.toBeNull()
  })

  it.each([
    '',
    'abc',
    '123',
    '00000000-0000-4000-8000-00000000000',
    '00000000-0000-4000-8000-0000000000000',
    "1' OR '1'='1",
    '../../etc/passwd',
    'null',
    ' ',
    '00000000-0000-4000-8000-00000000000g',
  ])('returns null (not an error) for the malformed id %j', async (id) => {
    const { scope } = await tenant('OWNER')
    await expect(brands.get(scope, id)).resolves.toBeNull()
  })
})

describe('every method rejects a forged scope', () => {
  async function forgeries(): Promise<[string, TenantScope][]> {
    const { org, user, scope } = await tenant('OWNER')
    const plain = {
      organizationId: String(org['id']),
      userId: String(user['id']),
      role: 'OWNER',
    }
    return [
      ['a plain object', plain as never],
      // Type-checks as a TenantScope (the brand survives a spread) but is not
      // registered, so the RUNTIME check is what rejects it.
      ['a spread copy of a real scope', { ...scope }],
      ['a JSON round trip', JSON.parse(JSON.stringify(scope))],
    ]
  }

  it('list, get and create throw TypeError and write nothing', async () => {
    for (const [name, forged] of await forgeries()) {
      await expect(brands.list(forged), name).rejects.toThrow(TypeError)
      await expect(
        brands.get(forged, '00000000-0000-4000-8000-000000000000'),
        name,
      ).rejects.toThrow(TypeError)
      await expect(
        brands.create(forged, { slug: 'x', name: 'X' }),
        name,
      ).rejects.toThrow(TypeError)
    }
    expect(await rowCount()).toBe(0)
  })
})
