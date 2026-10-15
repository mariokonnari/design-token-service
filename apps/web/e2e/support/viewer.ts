import pg from 'pg'
import { viewerDatabaseUrl } from './database'

/**
 * TEST-ONLY. There is no invitation or member API yet (ADR 0013), so a second role
 * cannot be created through the HTTP API. This helper adds a user (who must already
 * have signed up through the API) to an organization with a role by writing ONE row
 * straight into the e2e database.
 *
 * It is the only place the web suite writes to the database directly, so it is the
 * most careful one. It REFUSES to run unless the database name ends in `_test`
 * (the API tests' guard, `assertTestDatabase`), and checks twice:
 *   1. on the URL, before any connection is opened;
 *   2. on `current_database()` of the live connection, before the INSERT.
 * The statement uses parameters only. It never creates users.
 */

export type MemberRole = 'VIEWER' | 'EDITOR' | 'OWNER'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES: readonly MemberRole[] = ['VIEWER', 'EDITOR', 'OWNER']

/** The small slice of a pg client this helper uses (so a test can stand in for it). */
export interface DbClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
  end(): Promise<void>
}

export interface MemberDeps {
  env?: Record<string, string | undefined>
  /** Opens a connection. Default: a real `pg` client. */
  connect?: (url: string) => Promise<DbClient>
}

async function realConnect(url: string): Promise<DbClient> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return client
}

export async function addMember(
  input: { email: string; organizationId: string; role?: MemberRole },
  deps: MemberDeps = {},
): Promise<void> {
  const role = input.role ?? 'VIEWER'
  if (!ROLES.includes(role)) throw new Error(`Unknown role "${String(role)}".`)
  if (!UUID.test(input.organizationId)) {
    throw new Error('The organization id is not a UUID.')
  }
  // 1. The URL, before anything is opened.
  const url = viewerDatabaseUrl(deps.env ?? process.env)

  const client = await (deps.connect ?? realConnect)(url)
  try {
    // 2. The live connection.
    const current = await client.query('SELECT current_database() AS name')
    const reported = current.rows[0]?.['name']
    const name = typeof reported === 'string' ? reported : ''
    if (!name.endsWith('_test')) {
      throw new Error(
        `Refusing to write: the connected database is "${name}", and its name must end in "_test".`,
      )
    }
    const result = await client.query(
      `INSERT INTO "Membership" ("userId", "organizationId", "role")
       SELECT "id", $2::uuid, $3::"Role" FROM "User" WHERE "email" = $1`,
      [input.email, input.organizationId, role],
    )
    if (result.rowCount !== 1) {
      throw new Error(`No user with the email "${input.email}" to add.`)
    }
  } finally {
    await client.end()
  }
}

/** Shorthand for the common case. */
export function addViewer(
  input: { email: string; organizationId: string },
  deps?: MemberDeps,
): Promise<void> {
  return addMember({ ...input, role: 'VIEWER' }, deps)
}
