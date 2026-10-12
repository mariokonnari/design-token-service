import pg from 'pg'
import { afterAll, beforeEach } from 'vitest'
import { assertTestDatabase } from './guard'
import { truncateAll } from './truncate'

// Re-exported so existing tests keep importing it from here. The implementation
// lives in truncate.ts, which does not import Vitest (the e2e server entry needs it).
export { truncateAll }

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
