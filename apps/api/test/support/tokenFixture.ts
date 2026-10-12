import type pg from 'pg'
import request from 'supertest'
import type { Db } from '../../src/db/client'
import { makeBrand } from '../db/helpers'
import { authApp, del, put, type AuthAppOptions } from './authApp'
import { join, organization, person } from './orgFixture'

/** One organization with an owner, an editor, a viewer, and one empty brand. */
export async function tokenTeam(
  pool: pg.Pool,
  db: Db,
  options: AuthAppOptions = {},
) {
  const ctx = await authApp(db, options)
  const org = await organization(
    pool,
    `tok-${Math.random().toString(36).slice(2, 10)}`,
  )
  const owner = await person(pool, ctx.sessions, 'owner@example.com')
  const editor = await person(pool, ctx.sessions, 'editor@example.com')
  const viewer = await person(pool, ctx.sessions, 'viewer@example.com')
  await join(pool, owner.id, org, 'OWNER')
  await join(pool, editor.id, org, 'EDITOR')
  await join(pool, viewer.id, org, 'VIEWER')
  const brand = String((await makeBrand(pool, { organizationId: org }))['id'])
  return { ...ctx, org, brand, owner, editor, viewer }
}
export type TokenTeam = Awaited<ReturnType<typeof tokenTeam>>

export const brandUrl = (t: { org: string; brand: string }, tail = '') =>
  `/api/orgs/${t.org}/brands/${t.brand}${tail}`
export const tokensUrl = (t: { org: string; brand: string }, tail = '') =>
  brandUrl(t, `/tokens${tail}`)

export const COLOR = { colorSpace: 'srgb', components: [0.1, 0.2, 0.3] }
export const DIMENSION = { value: 16, unit: 'px' }

export interface TokenBody {
  token?: {
    path: string
    type: string | null
    value: unknown
    description: string | null
    version: number
  }
  tokens?: {
    path: string
    type: string | null
    value: unknown
    version: number
  }[]
  tree?: Record<string, unknown>
  draftRevision?: number
  currentRevision?: number
  warnings?: { code: string }[]
  issues?: { code: string; path: string; field?: string; message: string }[]
  publishable?: boolean
  count?: number
  error?: {
    code: string
    message: string
    details?: Record<string, unknown> & {
      issues?: { code: string; path: string; field?: string; message: string }[]
      currentVersion?: number | null
      currentRevision?: number
    }
  }
}

/** PUT a token as `who`'s cookie. */
export function putToken(
  t: TokenTeam,
  who: { cookie: string },
  path: string,
  body: unknown,
) {
  return put(request(t.app), tokensUrl(t, `/${path}`), body).set(
    'Cookie',
    who.cookie,
  )
}

export function deleteToken(
  t: TokenTeam,
  who: { cookie: string },
  path: string,
  expectedVersion?: number | string,
) {
  const query =
    expectedVersion === undefined ? '' : `?expectedVersion=${expectedVersion}`
  return del(request(t.app), tokensUrl(t, `/${path}${query}`)).set(
    'Cookie',
    who.cookie,
  )
}

export function getTokens(t: TokenTeam, who: { cookie: string }, tail = '') {
  return request(t.app).get(tokensUrl(t, tail)).set('Cookie', who.cookie)
}

/** The Token rows of a brand, straight from the database. */
export async function tokenRows(pool: pg.Pool, brandId: string) {
  const result = await pool.query<{
    path: string
    type: string | null
    value: unknown
    version: number
  }>(
    'SELECT path, type, value, version FROM "Token" WHERE "brandId" = $1 ORDER BY path',
    [brandId],
  )
  return result.rows
}

export async function revisionOf(pool: pg.Pool, brandId: string) {
  const result = await pool.query<{ draftRevision: number }>(
    'SELECT "draftRevision" FROM "Brand" WHERE id = $1',
    [brandId],
  )
  return result.rows[0]?.draftRevision ?? -1
}
