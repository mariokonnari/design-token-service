import type pg from 'pg'
import { assertTestDatabase } from './guard'

/**
 * Empties every table (except Prisma's migration history) of the TEST database.
 * It lives apart from `db.ts` because that file imports Vitest's hooks, and the
 * web e2e server entry (support/e2eServer.ts) runs under `tsx`, outside Vitest,
 * and needs this. Two guards, as before: the DATABASE_URL name must end in `_test`
 * and so must the database the connection really reached.
 */
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
