import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertTestDatabase, databaseNameOf } from './support/guard'

/**
 * Runs once before all test files: checks the safety guard, checks that
 * Postgres is reachable (with a readable message), creates the `*_test`
 * database if it does not exist, and applies the committed migrations to it.
 * Test files then run serially against that one database (see vitest.config.ts).
 */
export default async function setup(): Promise<void> {
  const url = assertTestDatabase(process.env['DATABASE_URL'])
  const name = databaseNameOf(url)

  // Connect to the maintenance database on the same server.
  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'
  const admin = new pg.Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 3000,
  })
  try {
    await admin.connect()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    throw new Error(
      `Postgres is not reachable at ${adminUrl.host} (${code}). ` +
        'Start the local database first: run `pnpm db:up`.',
    )
  }

  try {
    const found = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    )
    if (found.rowCount === 0) {
      // `name` was validated by the guard (lowercase letters, digits, underscores).
      await admin.query(`CREATE DATABASE "${name}"`)
    }
  } finally {
    await admin.end()
  }

  // Apply the committed migrations with the real Prisma CLI.
  const require = createRequire(import.meta.url)
  const prismaCli = require.resolve('prisma/build/index.js')
  const apiDir = fileURLToPath(new URL('..', import.meta.url))
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
  } catch (error) {
    const output = error as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(
      `prisma migrate deploy failed for the test database:\n${output.stdout?.toString() ?? ''}${output.stderr?.toString() ?? ''}`,
    )
  }
}
