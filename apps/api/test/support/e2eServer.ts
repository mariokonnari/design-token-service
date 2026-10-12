import net from 'node:net'
import pg from 'pg'
import globalSetup from '../globalSetup'
import { createPrismaClient } from '../../src/db/client'
import { createLogger } from '../../src/http/logger'
import { authApp } from './authApp'
import { assertTestDatabase, databaseNameOf } from './guard'
import { truncateAll } from './truncate'

/**
 * THE TEST-ONLY API SERVER for the web end-to-end suite (apps/web/e2e, ADR 0016).
 * Run with `tsx` from apps/api, outside Vitest. It is the real application (real
 * routes, real repositories, real Postgres, the real middleware stack) built the
 * way the API tests build it (`authApp`), with three differences that exist ONLY
 * here and never in production code:
 *   - password hashing uses fast scrypt parameters and the rate limits are set so
 *     high that no test hits them (the limiters themselves are tested in
 *     test/auth/rateLimit.test.ts);
 *   - the only allowed Origin is the web preview's (E2E_WEB_ORIGIN);
 *   - cookies are the development ones (`dts_session`, not `__Host-`/Secure), as on
 *     http://127.0.0.1. Production hardening is a Phase 6 concern (ADR 0013).
 *
 * Safety, in this order, before anything else happens:
 *   1. DATABASE_URL must name a database ending in `_test` (the same guard the
 *      API tests use). The web suite gets its own, `dts_e2e_test`, so it never
 *      shares tables with the API suite.
 *   2. The port must be FREE. If something already listens there (a developer's
 *      API, a leftover process) this exits with an error: the suite never reuses a
 *      running server, which could be writing to a development database.
 *   3. Only then: create the database if needed, apply the committed migrations,
 *      empty every table, and listen.
 *
 * Settings come from the environment (set by apps/web/playwright.config.ts):
 * DATABASE_URL, E2E_API_PORT (default 3100), E2E_WEB_ORIGIN (default
 * http://127.0.0.1:4173).
 */

const port = Number(process.env['E2E_API_PORT'] ?? '3100')
const webOrigin = process.env['E2E_WEB_ORIGIN'] ?? 'http://127.0.0.1:4173'

function fail(message: string): never {
  console.error(`e2e server: ${message}`)
  process.exit(1)
}

async function assertPortFree(): Promise<void> {
  await new Promise<void>((resolve) => {
    const probe = net.createServer()
    probe.once('error', (error: NodeJS.ErrnoException) => {
      fail(
        error.code === 'EADDRINUSE'
          ? `port ${port} is already in use: refusing to start. The e2e suite never reuses a running API (it could be writing to a development database). Stop whatever listens on ${port}.`
          : `cannot use port ${port}: ${error.message}`,
      )
    })
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => {
        resolve()
      })
    })
  })
}

let url: string
try {
  url = assertTestDatabase(process.env['DATABASE_URL'])
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

await assertPortFree()
await globalSetup() // creates the *_test database if missing, applies the migrations

const pool = new pg.Pool({ connectionString: url, max: 2 })
await truncateAll(pool)
await pool.end()

const db = createPrismaClient(url)
// A bounded logger: server errors (5xx, unhandled) to stderr, nothing kept in memory.
// Ordinary 4xx answers (wrong password, taken slug) are what the tests provoke on
// purpose, so they are not logged.
const logger = createLogger({ level: 'error', destination: process.stderr })
const { app } = await authApp(db, {
  config: { allowedOrigins: [webOrigin] },
  logger,
})

const server = app.listen(port, '127.0.0.1', () => {
  console.log(
    `e2e server listening on http://127.0.0.1:${port} (database ${databaseNameOf(url)}, allowed origin ${webOrigin})`,
  )
})
server.on('error', (error: NodeJS.ErrnoException) => {
  fail(
    error.code === 'EADDRINUSE'
      ? `port ${port} is already in use: refusing to start.`
      : error.message,
  )
})

function shutdown() {
  server.close(() => {
    void db.$disconnect().finally(() => {
      process.exit(0)
    })
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
