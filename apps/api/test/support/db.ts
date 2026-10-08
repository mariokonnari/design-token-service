import pg from 'pg'
import { afterAll, beforeEach } from 'vitest'
import { assertTestDatabase } from './guard'

/**
 * Opens a connection pool to the test database and truncates every table before
 * each test. Call once at the top of a DB test file. The guard runs again here
 * (and against the database the connection really reached) as a second line of
 * defense before anything is deleted.
 */
export function useDatabase(): { pool: pg.Pool } {
  const url = assertTestDatabase(process.env['DATABASE_URL'])
  const pool = new pg.Pool({ connectionString: url, max: 4 })

  beforeEach(async () => {
    await truncateAll(pool)
  })
  afterAll(async () => {
    await pool.end()
  })
  return { pool }
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  assertTestDatabase(process.env['DATABASE_URL'])
  const current = await pool.query<{ db: string }>(
    'SELECT current_database() AS db',
  )
  const database = current.rows[0]?.db ?? ''
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to truncate: connected to "${database}", not a *_test database.`,
    )
  }
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  )
  if (tables.rows.length === 0) return
  const list = tables.rows.map((row) => `"${row.tablename}"`).join(', ')
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}
