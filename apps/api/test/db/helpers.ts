import type pg from 'pg'

/** Raw-SQL helpers for the constraint tests: they bypass Prisma on purpose, so the DATABASE enforces the rules. */

type Row = Record<string, unknown>

export async function insert(
  pool: pg.Pool,
  table: string,
  values: Row,
): Promise<Row> {
  const columns = Object.keys(values)
  const placeholders = columns.map((_, i) => `$${i + 1}`)
  const params = columns.map((column) => {
    const value = values[column]
    // jsonb columns receive JSON text; everything else is passed through.
    return column === 'value' || column === 'snapshot'
      ? JSON.stringify(value)
      : value
  })
  const result = await pool.query<Row>(
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    params,
  )
  const row = result.rows[0]
  if (row === undefined) throw new Error(`insert into ${table} returned no row`)
  return row
}

/** The error a rejected statement raises: the SQLSTATE code and the violated constraint's name. */
export async function rejection(
  promise: Promise<unknown>,
): Promise<{ code: string; constraint: string | undefined }> {
  try {
    await promise
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string }
    return { code: code ?? 'no-code', constraint }
  }
  return { code: 'accepted', constraint: undefined }
}

export const SQLSTATE = {
  notNull: '23502',
  foreignKey: '23503',
  unique: '23505',
  check: '23514',
  invalidText: '22P02',
} as const

let counter = 0
const next = () => ++counter

export const makeOrg = (pool: pg.Pool, over: Row = {}) =>
  insert(pool, 'Organization', {
    slug: `org-${next()}`,
    name: 'An organization',
    ...over,
  })

export const makeUser = (pool: pg.Pool, over: Row = {}) =>
  insert(pool, 'User', {
    email: `user${next()}@example.com`,
    passwordHash: 'not-a-real-hash',
    ...over,
  })

export const makeBrand = async (pool: pg.Pool, over: Row = {}) => {
  const organizationId = over['organizationId'] ?? (await makeOrg(pool))['id']
  return insert(pool, 'Brand', {
    organizationId,
    slug: `brand-${next()}`,
    name: 'A brand',
    ...over,
  })
}

export const makeToken = async (pool: pg.Pool, over: Row = {}) => {
  const brandId = over['brandId'] ?? (await makeBrand(pool))['id']
  return insert(pool, 'Token', {
    brandId,
    path: `semantic.color.t${next()}`,
    type: 'color',
    value: { colorSpace: 'srgb', components: [0, 0, 0] },
    ...over,
  })
}

export const makeRelease = async (pool: pg.Pool, over: Row = {}) => {
  const brandId = over['brandId'] ?? (await makeBrand(pool))['id']
  const createdById = over['createdById'] ?? (await makeUser(pool))['id']
  return insert(pool, 'Release', {
    brandId,
    number: 1,
    sourceRevision: 0,
    snapshot: { tokens: {} },
    css: ':root {}',
    cssSha256: 'a'.repeat(64),
    createdById,
    ...over,
  })
}
