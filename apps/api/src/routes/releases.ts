import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getScope } from '../auth/requireOrg'
import type { ReleaseMeta, ReleaseRepository } from '../repositories/releases'
import type { RouteDef } from './table'
import { INT4_MAX } from './tokens'
import { NotFoundError } from '../errors'
import { parse, parseEmptyBody, uuidOrNotFound } from './validate'

export interface ReleaseRouteDeps {
  releases: ReleaseRepository
  /** Per-user limiter for publishing (createRateLimiters().publish). */
  publishLimiter: RequestHandler
}

export const MAX_NOTE_LENGTH = 500

const publishBody = z.strictObject({
  expectedRevision: z.number().int().min(0).max(INT4_MAX),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
})

/** A positive decimal integer string up to `max` (no sign, no leading zero, no exponent). */
const digits = (max: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

/** Strict: an unknown parameter, an empty value or a repeated one is a 400. */
const listQuery = z.strictObject({
  before: digits(INT4_MAX).optional(),
  limit: digits(MAX_PAGE_SIZE).optional(),
})

/** A release number in a URL: a positive int32, otherwise it can match nothing (404). */
function releaseNumber(value: unknown): number {
  const parsed = digits(INT4_MAX).safeParse(value)
  if (!parsed.success) throw new NotFoundError()
  return parsed.data
}

/** What the API says about a release without its snapshot or css. */
export function releaseView(release: ReleaseMeta) {
  return {
    number: release.number,
    sourceRevision: release.sourceRevision,
    note: release.note,
    createdAt: release.createdAt,
    createdById: release.createdById,
    cssSha256: release.cssSha256,
  }
}

const BASE = '/api/orgs/:orgId/brands/:brandId/releases'

/**
 * Release routes (ADR 0015). Publishing runs under the brand row lock in the
 * repository; the release rows themselves are immutable.
 */
export function releaseRoutes({
  releases,
  publishLimiter,
}: ReleaseRouteDeps): RouteDef[] {
  return [
    {
      method: 'post',
      path: BASE,
      access: { orgRole: 'EDITOR' },
      // After the access checks (a refused caller does not use up the allowance) and
      // before any database work.
      after: [publishLimiter],
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const body = parse(publishBody, req.body)
        const release = await releases.publish(getScope(res), brandId, {
          expectedRevision: body.expectedRevision,
          ...(body.note === undefined ? {} : { note: body.note }),
        })
        res.status(201).json({ release: releaseView(release) })
      },
    },

    {
      method: 'get',
      path: BASE,
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const query = parse(listQuery, req.query)
        const page = await releases.list(getScope(res), brandId, {
          limit: query.limit ?? DEFAULT_PAGE_SIZE,
          ...(query.before === undefined ? {} : { before: query.before }),
        })
        res.json({
          releases: page.releases.map(releaseView),
          nextBefore: page.nextBefore,
        })
      },
    },

    {
      method: 'get',
      path: `${BASE}/:number`,
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const number = releaseNumber(req.params['number'])
        parseEmptyBody(req.body)
        const release = await releases.get(getScope(res), brandId, number)
        res.json({
          release: { ...releaseView(release), snapshot: release.snapshot },
        })
      },
    },

    {
      // The strong ETag is the stored sha256 of the css; Express answers 304 for a
      // matching If-None-Match (exact, weak form, list or *) once the ETag is set.
      method: 'get',
      path: `${BASE}/:number/css`,
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const number = releaseNumber(req.params['number'])
        const { css, cssSha256 } = await releases.getCss(
          getScope(res),
          brandId,
          number,
        )
        res
          .set({
            'Content-Type': 'text/css; charset=utf-8',
            ETag: `"${cssSha256}"`,
            'Cache-Control': 'private, no-cache',
          })
          .send(css)
      },
    },
  ]
}
