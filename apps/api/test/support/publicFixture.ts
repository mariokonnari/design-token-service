import { createHash } from 'node:crypto'
import type pg from 'pg'
import request from 'supertest'
import { insert, makeBrand, makeOrg } from '../db/helpers'
import { publish, seedDraft } from './releaseFixture'
import { putToken, revisionOf, type TokenTeam } from './tokenFixture'

/** Helpers for the public endpoint tests (ADR 0015). */

export const publicPath = (orgSlug: string, brandSlug: string, tail: string) =>
  `/api/public/orgs/${orgSlug}/brands/${brandSlug}/${tail}`

export const sha256Hex = (text: string) =>
  createHash('sha256').update(text).digest('hex')

export async function slugsOf(
  pool: pg.Pool,
  t: { org: string; brand: string },
) {
  const org = await pool.query<{ slug: string }>(
    'SELECT slug FROM "Organization" WHERE id = $1',
    [t.org],
  )
  const brand = await pool.query<{ slug: string }>(
    'SELECT slug FROM "Brand" WHERE id = $1',
    [t.brand],
  )
  return {
    orgSlug: org.rows[0]?.slug ?? '',
    brandSlug: brand.rows[0]?.slug ?? '',
  }
}

export async function setVisibility(
  pool: pg.Pool,
  brandId: string,
  visibility: 'PUBLIC' | 'PRIVATE',
) {
  await pool.query('UPDATE "Brand" SET visibility = $2 WHERE id = $1', [
    brandId,
    visibility,
  ])
}

/**
 * A team whose brand has ONE published release (with a token description), and is
 * PUBLIC unless `visibility` says otherwise.
 */
export async function publishedTeam(
  pool: pg.Pool,
  t: TokenTeam,
  visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC',
) {
  await seedDraft(pool, t)
  await putToken(t, t.editor, 'semantic.color.action', {
    value: '{primitive.color.blue}',
    expectedVersion: 2,
    description: 'The main action colour',
  })
  const revision = await revisionOf(pool, t.brand)
  const r = await publish(t, t.editor, { expectedRevision: revision })
  if (r.status !== 201) throw new Error(`publish failed: ${r.status} ${r.text}`)
  await setVisibility(pool, t.brand, visibility)
  return { ...t, ...(await slugsOf(pool, t)) }
}

/**
 * ANOTHER brand in the team's organization (so a test needs only ONE tokenTeam: its
 * users are unique per database). Optionally with a published release.
 */
export async function extraBrand(
  pool: pg.Pool,
  t: TokenTeam,
  slug: string,
  visibility: 'PUBLIC' | 'PRIVATE',
  withRelease: boolean,
) {
  const brand = String(
    (
      await makeBrand(pool, {
        organizationId: t.org,
        slug,
        visibility,
      })
    )['id'],
  )
  const team = { ...t, brand }
  if (withRelease) {
    await seedDraft(pool, team)
    const revision = await revisionOf(pool, brand)
    const r = await publish(team, t.editor, { expectedRevision: revision })
    if (r.status !== 201) throw new Error(`publish failed: ${r.status}`)
  }
  return { ...team, ...(await slugsOf(pool, team)) }
}

/** Publishes another release after a one-token change. */
export async function publishAnother(
  pool: pg.Pool,
  t: TokenTeam,
  name: string,
  value: number,
) {
  await putToken(t, t.editor, `semantic.step.${name}`, {
    type: 'number',
    value,
  })
  const revision = await revisionOf(pool, t.brand)
  const r = await publish(t, t.editor, { expectedRevision: revision })
  if (r.status !== 201) throw new Error(`publish failed: ${r.status} ${r.text}`)
}

/**
 * Response headers without the ones that legitimately differ between two requests: the
 * request id, the date and the rate-limit COUNTER (it depends on how many requests came
 * before, never on why a request was refused).
 */
export function stableHeaders(r: request.Response): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(r.headers)) {
    if (['x-request-id', 'date', 'ratelimit'].includes(name)) continue
    out[name] = String(value)
  }
  return out
}

/** A db that fails on ANY use, to prove that something never reaches the database. */
export function untouchableDb<T extends object>(onUse: () => void): T {
  return new Proxy({} as T, {
    get() {
      onUse()
      throw new Error('the database must not be touched')
    },
  })
}

/** An organization + public brand with a release, written with raw SQL (other tenants in a test). */
export async function otherTenant(
  pool: pg.Pool,
  orgSlug: string,
  brandSlug: string,
  marker: string,
  userId: string,
) {
  const org = await makeOrg(pool, { slug: orgSlug })
  const brand = await makeBrand(pool, {
    organizationId: org['id'],
    slug: brandSlug,
    visibility: 'PUBLIC',
  })
  const css = `/* ${marker} */\n`
  await insert(pool, 'Release', {
    brandId: brand['id'],
    number: 1,
    sourceRevision: 0,
    snapshot: { marker },
    css,
    cssSha256: sha256Hex(css),
    createdById: userId,
  })
  return { orgId: String(org['id']), brandId: String(brand['id']), css }
}
