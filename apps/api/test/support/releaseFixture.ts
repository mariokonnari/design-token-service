import { createHash } from 'node:crypto'
import { nest } from '@dts/tokens-core'
import type pg from 'pg'
import request from 'supertest'
import { rowToToken } from '../../src/tokens/mapper'
import { ALLOWED_ORIGIN } from './http'
import {
  COLOR,
  brandUrl,
  putToken,
  revisionOf,
  type TokenTeam,
} from './tokenFixture'

/** Helpers for the release tests (ADR 0015). */

export const releasesUrl = (t: { org: string; brand: string }, tail = '') =>
  brandUrl(t, `/releases${tail}`)

export const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex')

export interface ReleaseMeta {
  number: number
  sourceRevision: number
  note: string | null
  createdAt: string
  createdById: string
  cssSha256: string
}

export interface ReleaseBody {
  release?: ReleaseMeta & { snapshot?: unknown; css?: unknown }
  releases?: ReleaseMeta[]
  nextBefore?: number | null
  error?: {
    code: string
    message: string
    details?: {
      currentRevision?: number
      latestReleaseNumber?: number
      limit?: number
      issues?: { code: string; path: string }[]
      issueCount?: number
    }
  }
}

/** POST /releases as `who` (or nobody). */
export function publish(
  t: { app: TokenTeam['app']; org: string; brand: string },
  who: { cookie: string } | null,
  body: unknown,
) {
  let test = request(t.app).post(releasesUrl(t)).set('Origin', ALLOWED_ORIGIN)
  if (who !== null) test = test.set('Cookie', who.cookie)
  return body === undefined
    ? test
    : test.set('Content-Type', 'application/json').send(body as object)
}

/**
 * A publishable draft: a primitive, a semantic alias and a component alias (3
 * mutations, so draftRevision is 3). Returns the revision.
 */
export async function seedDraft(pool: pg.Pool, t: TokenTeam): Promise<number> {
  const steps: [string, unknown][] = [
    ['primitive.color.blue', { type: 'color', value: COLOR }],
    ['semantic.color.action', { value: '{primitive.color.blue}' }],
    ['component.button.background', { value: '{semantic.color.action}' }],
  ]
  for (const [path, body] of steps) {
    const r = await putToken(t, t.editor, path, body)
    if (r.status !== 201) {
      throw new Error(`seeding ${path} failed: ${r.status} ${r.text}`)
    }
  }
  return revisionOf(pool, t.brand)
}

export interface StoredRelease {
  number: number
  sourceRevision: number
  snapshot: unknown
  css: string
  cssSha256: string
  note: string | null
  createdById: string
}

export async function releaseRows(
  pool: pg.Pool,
  brandId: string,
): Promise<StoredRelease[]> {
  const result = await pool.query<StoredRelease>(
    `SELECT number, "sourceRevision", snapshot, css, "cssSha256", note, "createdById"
       FROM "Release" WHERE "brandId" = $1 ORDER BY number`,
    [brandId],
  )
  return result.rows
}

/** Every Brand, Token and Release row, to prove that a refused request changed nothing. */
export async function tables(pool: pg.Pool) {
  return {
    brands: (await pool.query('SELECT * FROM "Brand" ORDER BY id')).rows,
    tokens: (await pool.query('SELECT * FROM "Token" ORDER BY id')).rows,
    releases: (await pool.query('SELECT * FROM "Release" ORDER BY id')).rows,
  }
}

/** The source tree the draft rows of a brand make right now (what a release snapshot must equal). */
export async function draftTree(pool: pg.Pool, brandId: string) {
  const result = await pool.query<{
    path: string
    type: string | null
    value: unknown
    description: string | null
  }>(
    'SELECT path, type, value, description FROM "Token" WHERE "brandId" = $1',
    [brandId],
  )
  const tokens = result.rows.flatMap((row) => {
    const mapped = rowToToken(row)
    return mapped.ok ? [mapped.token] : []
  })
  return nest(tokens).tree
}

export async function brandSlug(pool: pg.Pool, brandId: string) {
  const result = await pool.query<{ slug: string }>(
    'SELECT slug FROM "Brand" WHERE id = $1',
    [brandId],
  )
  return result.rows[0]?.slug ?? ''
}
