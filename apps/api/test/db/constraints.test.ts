import { TOKEN_TYPES } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { useDatabase } from '../support/db'
import {
  SQLSTATE,
  insert,
  makeBrand,
  makeOrg,
  makeRelease,
  makeToken,
  makeUser,
  rejection,
} from './helpers'

// These tests talk to a REAL Postgres and insert rows with raw SQL, bypassing
// Prisma and the application, to prove that the DATABASE itself rejects bad
// data (defense in depth). Each CHECK is named so a test can assert WHICH rule
// fired, not just that something failed.

const { pool } = useDatabase()

const VALID_SLUGS = ['acme', 'a', 'a1', 'my-brand', 'a-b-c', '0x', '9-9']
const INVALID_SLUGS = [
  '',
  'Acme',
  'ACME',
  'a_b',
  '-a',
  'a-',
  'a--b',
  'a b',
  'a.b',
  'é',
  'a/b',
  'a\n',
  ' a',
  'a\tb',
]

describe.each([
  ['Organization', 'Organization_slug_format'],
  ['Brand', 'Brand_slug_format'],
] as const)('%s.slug CHECK', (table, constraint) => {
  const make = async (slug: string) =>
    table === 'Organization'
      ? makeOrg(pool, { slug })
      : makeBrand(pool, { slug })

  it.each(VALID_SLUGS)('accepts %j', async (slug) => {
    await expect(make(slug)).resolves.toBeTruthy()
  })

  it.each(INVALID_SLUGS)('rejects %j', async (slug) => {
    expect(await rejection(make(slug))).toEqual({
      code: SQLSTATE.check,
      constraint,
    })
  })
})

describe('Token.path CHECK', () => {
  const brand = async () => (await makeBrand(pool))['id']

  it.each([
    'a',
    'primitive.color.blue-500',
    'semantic.color.action',
    'a.b.c.d',
    '0.1',
  ])('accepts %j', async (path) => {
    await expect(
      makeToken(pool, { brandId: await brand(), path }),
    ).resolves.toBeTruthy()
  })

  it.each([
    '',
    '.a',
    'a.',
    'a..b',
    'A.b',
    'a.B',
    'a.b_c',
    'a b',
    'a.-b',
    'a.b-',
    'a.b--c',
    'a/b',
    'é.b',
    'a.b\n',
  ])('rejects %j', async (path) => {
    expect(
      await rejection(makeToken(pool, { brandId: await brand(), path })),
    ).toEqual({ code: SQLSTATE.check, constraint: 'Token_path_format' })
  })
})

describe('User.email CHECK (stored lowercase)', () => {
  it.each(['a@b.co', 'x.y+z@example.com', '123@456.org'])(
    'accepts %j',
    async (email) => {
      await expect(makeUser(pool, { email })).resolves.toBeTruthy()
    },
  )

  it.each(['A@b.co', 'a@B.co', 'Mixed@Case.com', 'USER@EXAMPLE.COM'])(
    'rejects %j',
    async (email) => {
      expect(await rejection(makeUser(pool, { email }))).toEqual({
        code: SQLSTATE.check,
        constraint: 'User_email_lowercase',
      })
    },
  )
})

describe('Token.type CHECKs (nullable; supported types only)', () => {
  const alias = '{semantic.color.action}'
  const literal = { colorSpace: 'srgb', components: [0.1, 0.2, 0.3] }
  const brandId = async () => (await makeBrand(pool))['id']

  it('accepts an UNTYPED alias (it inherits its target type)', async () => {
    await expect(
      makeToken(pool, { brandId: await brandId(), type: null, value: alias }),
    ).resolves.toBeTruthy()
  })

  it('accepts a TYPED alias', async () => {
    await expect(
      makeToken(pool, {
        brandId: await brandId(),
        type: 'color',
        value: alias,
      }),
    ).resolves.toBeTruthy()
  })

  it.each(TOKEN_TYPES)('accepts a typed literal of type %s', async (type) => {
    await expect(
      makeToken(pool, { brandId: await brandId(), type, value: literal }),
    ).resolves.toBeTruthy()
  })

  it('rejects an UNTYPED literal (an object value)', async () => {
    expect(
      await rejection(
        makeToken(pool, {
          brandId: await brandId(),
          type: null,
          value: literal,
        }),
      ),
    ).toEqual({
      code: SQLSTATE.check,
      constraint: 'Token_type_null_only_for_alias',
    })
  })

  it.each([
    ['a plain string', 'hello'],
    ['a number', 16],
    ['a boolean', true],
    ['an array', ['{a.b}']],
    ['an empty alias', '{}'],
    ['two aliases', '{a.b}{c.d}'],
    ['a nested brace', '{a.{b}}'],
    ['an alias with text around it', 'x{a.b}'],
    ['an alias with a trailing space', '{a.b} '],
    ['an unclosed alias', '{a.b'],
  ])('rejects an UNTYPED %s', async (_name, value) => {
    expect(
      await rejection(
        makeToken(pool, { brandId: await brandId(), type: null, value }),
      ),
    ).toEqual({
      code: SQLSTATE.check,
      constraint: 'Token_type_null_only_for_alias',
    })
  })

  it.each(['string', 'Color', 'color ', '', 'boolean', 'COLOR', 'cubicBezier'])(
    'rejects the bad type %j',
    async (type) => {
      expect(
        await rejection(
          makeToken(pool, { brandId: await brandId(), type, value: literal }),
        ),
      ).toEqual({ code: SQLSTATE.check, constraint: 'Token_type_supported' })
    },
  )

  it('keeps the SQL type list in sync with tokens-core', async () => {
    const result = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'Token_type_supported'`,
    )
    const definition = result.rows[0]?.definition ?? ''
    const inSql = [...definition.matchAll(/'([A-Za-z]+)'::text/g)]
      .map((match) => match[1])
      .sort()
    expect(inSql).toEqual([...TOKEN_TYPES].sort())
  })
})

describe('Release CHECKs', () => {
  it.each([1, 2, 1000])('accepts number %i', async (number) => {
    await expect(makeRelease(pool, { number })).resolves.toBeTruthy()
  })

  it.each([0, -1, -100])('rejects number %i', async (number) => {
    expect(await rejection(makeRelease(pool, { number }))).toEqual({
      code: SQLSTATE.check,
      constraint: 'Release_number_positive',
    })
  })

  it.each(['a'.repeat(64), '0123456789abcdef'.repeat(4)])(
    'accepts the sha256 %s',
    async (cssSha256) => {
      await expect(makeRelease(pool, { cssSha256 })).resolves.toBeTruthy()
    },
  )

  it.each(['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '', 'g'.repeat(64)])(
    'rejects the sha256 %j',
    async (cssSha256) => {
      expect(await rejection(makeRelease(pool, { cssSha256 }))).toEqual({
        code: SQLSTATE.check,
        constraint: 'Release_cssSha256_format',
      })
    },
  )

  it('requires sourceRevision (the draftRevision the release was built from)', async () => {
    const brand = await makeBrand(pool)
    const user = await makeUser(pool)
    expect(
      await rejection(
        insert(pool, 'Release', {
          brandId: brand['id'],
          number: 1,
          snapshot: {},
          css: '',
          cssSha256: 'a'.repeat(64),
          createdById: user['id'],
        }),
      ),
    ).toEqual({ code: SQLSTATE.notNull, constraint: undefined })
  })
})

describe('unique constraints', () => {
  it('Organization.slug is unique', async () => {
    await makeOrg(pool, { slug: 'same' })
    expect((await rejection(makeOrg(pool, { slug: 'same' }))).code).toBe(
      SQLSTATE.unique,
    )
  })

  it('User.email is unique', async () => {
    await makeUser(pool, { email: 'a@b.co' })
    expect((await rejection(makeUser(pool, { email: 'a@b.co' }))).code).toBe(
      SQLSTATE.unique,
    )
  })

  it('Membership is unique per (user, organization)', async () => {
    const user = await makeUser(pool)
    const org = await makeOrg(pool)
    const values = {
      userId: user['id'],
      organizationId: org['id'],
      role: 'EDITOR',
    }
    await insert(pool, 'Membership', values)
    expect((await rejection(insert(pool, 'Membership', values))).code).toBe(
      SQLSTATE.unique,
    )
    // The same user may belong to another organization.
    await expect(
      insert(pool, 'Membership', {
        ...values,
        organizationId: (await makeOrg(pool))['id'],
      }),
    ).resolves.toBeTruthy()
  })

  it('Brand.slug is unique per organization, not globally', async () => {
    const a = await makeOrg(pool)
    const b = await makeOrg(pool)
    await makeBrand(pool, { organizationId: a['id'], slug: 'main' })
    expect(
      (
        await rejection(
          makeBrand(pool, { organizationId: a['id'], slug: 'main' }),
        )
      ).code,
    ).toBe(SQLSTATE.unique)
    await expect(
      makeBrand(pool, { organizationId: b['id'], slug: 'main' }),
    ).resolves.toBeTruthy()
  })

  it('Token.path is unique per brand, not globally', async () => {
    const one = (await makeBrand(pool))['id']
    const two = (await makeBrand(pool))['id']
    await makeToken(pool, { brandId: one, path: 'a.b' })
    expect(
      (await rejection(makeToken(pool, { brandId: one, path: 'a.b' }))).code,
    ).toBe(SQLSTATE.unique)
    await expect(
      makeToken(pool, { brandId: two, path: 'a.b' }),
    ).resolves.toBeTruthy()
  })

  it('Release.number is unique per brand, not globally', async () => {
    const one = (await makeBrand(pool))['id']
    const two = (await makeBrand(pool))['id']
    await makeRelease(pool, { brandId: one, number: 1 })
    expect(
      (await rejection(makeRelease(pool, { brandId: one, number: 1 }))).code,
    ).toBe(SQLSTATE.unique)
    await expect(
      makeRelease(pool, { brandId: two, number: 1 }),
    ).resolves.toBeTruthy()
  })
})

describe('defaults and enums', () => {
  it('generates uuid ids and applies the column defaults', async () => {
    const org = await makeOrg(pool)
    const user = await makeUser(pool)
    const brand = await makeBrand(pool, { organizationId: org['id'] })
    const token = await makeToken(pool, { brandId: brand['id'] })
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    for (const row of [org, user, brand, token]) {
      expect(String(row['id'])).toMatch(uuid)
    }
    expect(user['sessionVersion']).toBe(0)
    expect(brand['visibility']).toBe('PRIVATE')
    expect(brand['draftRevision']).toBe(0)
    expect(token['version']).toBe(1)
    expect(token['description']).toBeNull()
    expect(token['updatedAt']).toBeInstanceOf(Date)
    expect(org['createdAt']).toBeInstanceOf(Date)
  })

  it('rejects an unknown role and an unknown visibility', async () => {
    const user = await makeUser(pool)
    const org = await makeOrg(pool)
    expect(
      (
        await rejection(
          insert(pool, 'Membership', {
            userId: user['id'],
            organizationId: org['id'],
            role: 'ADMIN',
          }),
        )
      ).code,
    ).toBe(SQLSTATE.invalidText)
    expect(
      (await rejection(makeBrand(pool, { visibility: 'SECRET' }))).code,
    ).toBe(SQLSTATE.invalidText)
  })

  it('accepts every role and both visibilities', async () => {
    const org = await makeOrg(pool)
    for (const role of ['OWNER', 'EDITOR', 'VIEWER']) {
      await insert(pool, 'Membership', {
        userId: (await makeUser(pool))['id'],
        organizationId: org['id'],
        role,
      })
    }
    for (const visibility of ['PRIVATE', 'PUBLIC']) {
      await makeBrand(pool, { organizationId: org['id'], visibility })
    }
  })
})

describe('foreign keys, cascades and restrictions', () => {
  it('rejects rows that point at a missing parent', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      (await rejection(makeBrand(pool, { organizationId: missing }))).code,
    ).toBe(SQLSTATE.foreignKey)
    expect((await rejection(makeToken(pool, { brandId: missing }))).code).toBe(
      SQLSTATE.foreignKey,
    )
  })

  it('deleting a user CASCADES to their memberships', async () => {
    const user = await makeUser(pool)
    const org = await makeOrg(pool)
    await insert(pool, 'Membership', {
      userId: user['id'],
      organizationId: org['id'],
      role: 'OWNER',
    })
    await pool.query('DELETE FROM "User" WHERE id = $1', [user['id']])
    const left = await pool.query('SELECT 1 FROM "Membership"')
    expect(left.rowCount).toBe(0)
    // The organization itself is untouched.
    expect((await pool.query('SELECT 1 FROM "Organization"')).rowCount).toBe(1)
  })

  it('deleting an organization with only memberships CASCADES to them', async () => {
    const org = await makeOrg(pool)
    await insert(pool, 'Membership', {
      userId: (await makeUser(pool))['id'],
      organizationId: org['id'],
      role: 'VIEWER',
    })
    await pool.query('DELETE FROM "Organization" WHERE id = $1', [org['id']])
    expect((await pool.query('SELECT 1 FROM "Membership"')).rowCount).toBe(0)
    // The user is untouched.
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(1)
  })

  it('deleting an organization that has brands is RESTRICTED', async () => {
    const brand = await makeBrand(pool)
    const result = await rejection(
      pool.query('DELETE FROM "Organization" WHERE id = $1', [
        brand['organizationId'],
      ]),
    )
    expect(result.code).toBe(SQLSTATE.foreignKey)
    expect((await pool.query('SELECT 1 FROM "Brand"')).rowCount).toBe(1)
  })

  it('deleting a brand with only tokens CASCADES to the tokens', async () => {
    const token = await makeToken(pool)
    await makeToken(pool, { brandId: token['brandId'] })
    await pool.query('DELETE FROM "Brand" WHERE id = $1', [token['brandId']])
    expect((await pool.query('SELECT 1 FROM "Token"')).rowCount).toBe(0)
  })

  it('deleting a brand that has releases is RESTRICTED, and its tokens survive', async () => {
    const release = await makeRelease(pool)
    await makeToken(pool, { brandId: release['brandId'] })
    const result = await rejection(
      pool.query('DELETE FROM "Brand" WHERE id = $1', [release['brandId']]),
    )
    expect(result.code).toBe(SQLSTATE.foreignKey)
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(1)
    expect((await pool.query('SELECT 1 FROM "Token"')).rowCount).toBe(1)
  })

  it('deleting a user who created a release is RESTRICTED', async () => {
    const release = await makeRelease(pool)
    const result = await rejection(
      pool.query('DELETE FROM "User" WHERE id = $1', [release['createdById']]),
    )
    expect(result.code).toBe(SQLSTATE.foreignKey)
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(1)
  })
})

describe('indexes', () => {
  it('every foreign key column leads some index (so lookups and joins are not sequential scans)', async () => {
    const missing = await pool.query<{ tbl: string; col: string }>(
      `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`,
    )
    expect(missing.rows).toEqual([])
    // Not vacuous: the schema really has foreign keys.
    const total = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    )
    // Membership x2, Brand, Token and Release x2.
    expect(total.rowCount).toBeGreaterThanOrEqual(6)
  })
})
