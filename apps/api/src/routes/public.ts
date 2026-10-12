import { createHash } from 'node:crypto'
import type { RequestHandler } from 'express'
import { NotFoundError } from '../errors'
import {
  isPublicSlug,
  type PublicReleaseRepository,
} from '../repositories/public/releases'
import type { RouteDef } from './table'

export interface PublicRouteDeps {
  releases: PublicReleaseRepository
  /** Per-IP limiter (createRateLimiters().publicRead). */
  limiter: RequestHandler
}

/** Browsers and shared caches may keep a public answer this long (no `immutable`). */
export const PUBLIC_MAX_AGE_SECONDS = 60

/**
 * The cross-origin exception (ADR 0015), attached to the two public routes ONLY, and
 * placed first in their chain so that their 404 and 429 carry it too (a failed
 * cross-origin load is then readable, and every refusal stays byte-identical).
 *
 * - `Cross-Origin-Resource-Policy: cross-origin` overrides helmet's `same-origin`
 *   default, which would make browsers refuse `<link rel="stylesheet">` from another site.
 * - `Access-Control-Allow-Origin: *` with no credentials (never reflected, never
 *   `Allow-Credentials`): only "simple" cross-origin requests are supported, a
 *   preflight gets no CORS headers by design (ADR 0013 stays true for every other route).
 * - `Cache-Control: no-store` is the default for every answer; the 200 handlers replace it.
 * helmet's `X-Content-Type-Options: nosniff` is untouched.
 */
export const publicHeaders: RequestHandler = function publicHeaders(
  _req,
  res,
  next,
) {
  res.set({
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  next()
}

/** A slug in the URL, or the uniform 404 (before any database access). */
function slug(value: unknown): string {
  if (!isPublicSlug(value)) throw new NotFoundError()
  return value
}

const BASE = '/api/public/orgs/:orgSlug/brands/:brandSlug'
const CACHE_CONTROL = `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`

/**
 * Public release routes (ADR 0015): no session, the LATEST release of a PUBLIC brand.
 * A private brand, a missing brand or organization, a brand without releases and a
 * malformed slug are all the SAME 404 (`NotFoundError` through the central handler).
 * Success answers carry a strong ETag (Express turns a matching If-None-Match into a
 * 304) and a 60-second public cache.
 */
export function publicRoutes({
  releases,
  limiter,
}: PublicRouteDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: `${BASE}/css`,
      access: 'public',
      before: [publicHeaders, limiter],
      handler: async (req, res) => {
        const release = await releases.latest(
          slug(req.params['orgSlug']),
          slug(req.params['brandSlug']),
        )
        if (release === null) throw new NotFoundError()
        res
          .set({
            'Content-Type': 'text/css; charset=utf-8',
            ETag: `"${release.cssSha256}"`,
            'Cache-Control': CACHE_CONTROL,
          })
          .send(release.css)
      },
    },
    {
      method: 'get',
      path: `${BASE}/json`,
      access: 'public',
      before: [publicHeaders, limiter],
      handler: async (req, res) => {
        const release = await releases.latest(
          slug(req.params['orgSlug']),
          slug(req.params['brandSlug']),
        )
        if (release === null) throw new NotFoundError()
        // The SOURCE tree as stored (aliases, descriptions): not the resolved values.
        const text = JSON.stringify(release.snapshot)
        const etag = createHash('sha256').update(text).digest('hex')
        res
          .set({
            'Content-Type': 'application/json; charset=utf-8',
            ETag: `"${etag}"`,
            'Cache-Control': CACHE_CONTROL,
          })
          .send(text)
      },
    },
  ]
}
