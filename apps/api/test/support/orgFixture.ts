import type pg from 'pg'
import type { SessionService } from '../../src/auth/session'
import type { Role } from '../../src/tenancy/scope'
import { insert, makeOrg, makeUser } from '../db/helpers'

/** Rows written straight to the database, so HTTP tests need no scrypt and no signup. */

export interface Person {
  id: string
  email: string
  /** A valid session cookie header for this user. */
  cookie: string
}

export async function person(
  pool: pg.Pool,
  sessions: SessionService,
  email: string,
): Promise<Person> {
  const row = await makeUser(pool, { email })
  const id = String(row['id'])
  return { id, email, cookie: `dts_session=${await sessions.sign(id, 0)}` }
}

export async function organization(
  pool: pg.Pool,
  slug: string,
): Promise<string> {
  return String((await makeOrg(pool, { slug, name: slug.toUpperCase() }))['id'])
}

export async function join(
  pool: pg.Pool,
  userId: string,
  organizationId: string,
  role: Role,
): Promise<void> {
  await insert(pool, 'Membership', { userId, organizationId, role })
}

export async function ownersOf(
  pool: pg.Pool,
  organizationId: string,
): Promise<string[]> {
  const result = await pool.query<{ userId: string }>(
    `SELECT "userId" FROM "Membership" WHERE "organizationId" = $1 AND role = 'OWNER' ORDER BY "userId"`,
    [organizationId],
  )
  return result.rows.map((row) => row.userId)
}

export async function roleOf(
  pool: pg.Pool,
  organizationId: string,
  userId: string,
): Promise<Role | null> {
  const result = await pool.query<{ role: Role }>(
    'SELECT role FROM "Membership" WHERE "organizationId" = $1 AND "userId" = $2',
    [organizationId, userId],
  )
  return result.rows[0]?.role ?? null
}
