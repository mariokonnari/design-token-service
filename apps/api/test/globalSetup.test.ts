import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import setup from './globalSetup'
import { truncateAll, useDatabase } from './support/db'
import { insert, makeBrand, makeOrg, makeUser } from './db/helpers'

// The global setup already ran successfully to get here. These tests call it
// again with other URLs to check the failure messages and the truncate safety.

const original = process.env['DATABASE_URL']
afterEach(() => {
  process.env['DATABASE_URL'] = original
})

describe('globalSetup failures are readable', () => {
  it('says how to start Postgres when it is not reachable (no raw connection error)', async () => {
    // Port 1 has no listener: the connection is refused.
    process.env['DATABASE_URL'] = 'postgresql://dts:dts@127.0.0.1:1/dts_test'
    const error = await setup().then(
      () => undefined,
      (caught: unknown) => caught as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toMatch(
      /Postgres is not reachable at 127\.0\.0\.1:1/,
    )
    expect(error?.message).toMatch(/pnpm db:up/)
    expect(error?.message).not.toMatch(/ECONNREFUSED.*\n\s+at /s)
  })

  it('refuses a database that is not a *_test database before connecting', async () => {
    process.env['DATABASE_URL'] = 'postgresql://dts:dts@localhost:5433/dts_dev'
    await expect(setup()).rejects.toThrow(/Refusing to run the tests/)
  })

  it('refuses when DATABASE_URL is missing', async () => {
    delete process.env['DATABASE_URL']
    await expect(setup()).rejects.toThrow(/DATABASE_URL is not set/)
  })
})

describe('truncateAll', () => {
  const { pool } = useDatabase()

  it('empties every table but keeps the migration history', async () => {
    const org = await makeOrg(pool)
    const user = await makeUser(pool)
    await insert(pool, 'Membership', {
      userId: user['id'],
      organizationId: org['id'],
      role: 'OWNER',
    })
    await makeBrand(pool)
    const before = await pool.query('SELECT 1 FROM "Brand"')
    expect(before.rowCount).toBe(1)

    await truncateAll(pool)

    for (const table of ['Organization', 'User', 'Membership', 'Brand']) {
      expect(
        (await pool.query(`SELECT 1 FROM "${table}"`)).rowCount,
        table,
      ).toBe(0)
    }
    const migrations = await pool.query('SELECT 1 FROM "_prisma_migrations"')
    expect(migrations.rowCount).toBeGreaterThan(0)
  })

  it('starts every test from empty tables (the beforeEach truncate ran)', async () => {
    for (const table of ['Organization', 'User', 'Brand', 'Token', 'Release']) {
      expect(
        (await pool.query(`SELECT 1 FROM "${table}"`)).rowCount,
        table,
      ).toBe(0)
    }
  })

  it('refuses to truncate when the connection really reached a non-test database', async () => {
    // DATABASE_URL still says *_test, but this pool points at another database on
    // the same server: the maintenance database `postgres`, which exists on every
    // server (local compose and CI alike). The second line of defense checks
    // current_database(), not the URL.
    const other = new URL(process.env['DATABASE_URL'] ?? '')
    other.pathname = '/postgres'
    const pool = new pg.Pool({ connectionString: other.toString(), max: 1 })
    try {
      await expect(truncateAll(pool)).rejects.toThrow(
        /Refusing to truncate: connected to "postgres"/,
      )
    } finally {
      await pool.end()
    }
  })
})
