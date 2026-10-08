import pg from 'pg'

export interface ReadinessCheck {
  /** True if a trivial query succeeds within the timeout; never throws. */
  check: () => Promise<boolean>
  close: () => Promise<void>
}

const TIMEOUT_MS = 2000

/**
 * The readiness probe behind GET /ready. It uses `pg` directly, not the ORM, so
 * it does not depend on a generated client. The pool is created lazily on the
 * first check: the app never connects to the database at startup, and /health
 * never touches it.
 */
export function createReadinessCheck(databaseUrl: string): ReadinessCheck {
  let pool: pg.Pool | undefined

  function getPool(): pg.Pool {
    if (pool === undefined) {
      pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: TIMEOUT_MS,
        query_timeout: TIMEOUT_MS,
      })
      // An idle connection dropping must not crash the process.
      pool.on('error', () => undefined)
    }
    return pool
  }

  return {
    async check() {
      try {
        await getPool().query('SELECT 1')
        return true
      } catch {
        return false
      }
    },
    async close() {
      await pool?.end()
      pool = undefined
    },
  }
}
