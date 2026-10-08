/**
 * Safety guard for the database tests. They TRUNCATE every table between tests,
 * so they must never run against a real database. The rule: the database name
 * in DATABASE_URL must end in `_test`.
 */

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

/** Returns the URL when it is safe to use for tests; throws otherwise. Never echoes credentials. */
export function assertTestDatabase(url: string | undefined): string {
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. The tests need a database whose name ends in "_test".',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }
  const name = databaseNameOf(url)
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run the tests: DATABASE_URL points at database "${name}" on ${parsed.host}. ` +
        'The name must end in "_test", because the tests truncate every table and must never touch a real database.',
    )
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(
      `Refusing to run the tests: the database name "${name}" may only contain lowercase letters, digits and underscores.`,
    )
  }
  return url
}
