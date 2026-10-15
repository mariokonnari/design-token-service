import { assertTestDatabase } from '../../../api/test/support/guard'

/**
 * Which database the web e2e suite uses, in ONE place (playwright.config.ts starts
 * the API against it; the Viewer helper writes into it): its OWN database
 * (`dts_e2e_test`) on the same server as the API tests' `dts_test`, so the two
 * suites never share tables. Derived from DATABASE_URL (CI sets it to the service
 * container) or the local compose default; E2E_DATABASE_URL overrides.
 */

const COMPOSE_DEFAULT = 'postgresql://dts:dts@localhost:5433/dts_test'

export function e2eDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env['E2E_DATABASE_URL']
  if (explicit !== undefined && explicit !== '') return explicit
  const url = new URL(env['DATABASE_URL'] || COMPOSE_DEFAULT)
  url.pathname = '/dts_e2e_test'
  return url.toString()
}

/**
 * The e2e database URL, or an error. The same guard the API tests use
 * (`assertTestDatabase`): the name must end in `_test`. It never echoes credentials.
 * Used by every e2e helper that writes to the database directly.
 */
export function viewerDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env['E2E_DATABASE_URL']
  if (
    (explicit === undefined || explicit === '') &&
    (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '')
  ) {
    throw new Error(
      'No database is configured for the e2e helper: set DATABASE_URL or E2E_DATABASE_URL (the name must end in "_test").',
    )
  }
  return assertTestDatabase(e2eDatabaseUrl(env))
}
