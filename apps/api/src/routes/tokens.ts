import { comparePaths, nest, type Issue } from '@dts/tokens-core'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getScope } from '../auth/requireOrg'
import { NotFoundError, ValidationError } from '../errors'
import type { TokenRecord, TokenRepository } from '../repositories/tokens'
import { rowToToken, type DraftIssue } from '../tokens/mapper'
import { validateDraft } from '../tokens/validateDraft'
import { validateImport } from '../tokens/validateImport'
import { validateSingleToken } from '../tokens/validateWrite'
import type { RouteDef } from './table'
import { parse, parseEmptyBody, uuidOrNotFound } from './validate'

export interface TokenRouteDeps {
  tokens: TokenRepository
  /** Per-user limiter for the import route (createRateLimiters().tokenImport). */
  importLimiter: RequestHandler
}

export const IMPORT_BODY_LIMIT = '512kb'

/** int4 is the column type of Token.version and Brand.draftRevision. */
export const INT4_MAX = 2147483647

const version = z.number().int().min(1).max(INT4_MAX)

const putBody = z.strictObject({
  type: z.string().optional(),
  value: z.unknown(),
  description: z.string().optional(),
  expectedVersion: version.optional(),
})

/** The tree is validated by validateImport (it is untrusted and arbitrarily shaped). */
const importBody = z.strictObject({
  tree: z.unknown(),
  expectedRevision: z.number().int().min(0).max(INT4_MAX),
})

/** `?expectedVersion=N`: one digit string, 1..INT4_MAX, and nothing else in the query. */
const deleteQuery = z.strictObject({
  expectedVersion: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(version),
})

/** At most this many issues are sent back; a broken import can have thousands. */
export const MAX_ISSUES_IN_RESPONSE = 50

export function issueView(issue: Issue | DraftIssue) {
  return {
    code: issue.code,
    severity: issue.severity,
    path: issue.path,
    ...(issue.field === undefined ? {} : { field: issue.field }),
    message: issue.message,
    ...(issue.related === undefined ? {} : { related: issue.related }),
  }
}

export function invalidWith(
  message: string,
  code: string,
  issues: readonly (Issue | DraftIssue)[],
): ValidationError {
  return new ValidationError(message, code, {
    issues: issues.slice(0, MAX_ISSUES_IN_RESPONSE).map(issueView),
    issueCount: issues.length,
  })
}

function tokenView(token: TokenRecord) {
  return {
    path: token.path,
    type: token.type,
    value: token.value,
    description: token.description,
    version: token.version,
    updatedAt: token.updatedAt,
  }
}

/** A malformed path in a URL can match no token: 404 (for a PUT it is a 400 with issues). */
const PATH_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/

function pathParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const BASE = '/api/orgs/:orgId/brands/:brandId/tokens'

/**
 * Draft token routes (ADR 0014). Mutations are serialized per brand by a row lock in
 * the repository; reads take no lock and return one consistent snapshot.
 */
export function tokenRoutes({
  tokens,
  importLimiter,
}: TokenRouteDeps): RouteDef[] {
  return [
    {
      method: 'get',
      path: BASE,
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const snapshot = await tokens.read(
          getScope(res),
          uuidOrNotFound(req.params['brandId']),
        )
        res.json({
          draftRevision: snapshot.draftRevision,
          tokens: [...snapshot.tokens]
            .sort((a, b) => comparePaths(a.path, b.path))
            .map(tokenView),
        })
      },
    },

    {
      method: 'get',
      path: `${BASE}/tree`,
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const snapshot = await tokens.read(
          getScope(res),
          uuidOrNotFound(req.params['brandId']),
        )
        const mapped = snapshot.tokens.map(rowToToken)
        const good = mapped.flatMap((m) => (m.ok ? [m.token] : []))
        const issues: (Issue | DraftIssue)[] = mapped.flatMap((m) =>
          m.ok ? [] : [m.issue],
        )
        const nested = nest(good)
        res.json({
          draftRevision: snapshot.draftRevision,
          tree: nested.tree,
          issues: [...issues, ...nested.issues].map(issueView),
        })
      },
    },

    {
      // Under /brands/:brandId, not /tokens: validation is about the whole draft.
      method: 'get',
      path: '/api/orgs/:orgId/brands/:brandId/validate',
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const snapshot = await tokens.read(
          getScope(res),
          uuidOrNotFound(req.params['brandId']),
        )
        const { issues, publishable } = validateDraft(snapshot.tokens)
        res.json({
          draftRevision: snapshot.draftRevision,
          publishable,
          issues: issues.map(issueView),
        })
      },
    },

    {
      method: 'put',
      path: `${BASE}/:path`,
      access: { orgRole: 'EDITOR' },
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const path = pathParam(req.params['path'])
        const body = parse(putBody, req.body)
        const checked = validateSingleToken({
          path,
          type: body.type,
          value: body.value,
          description: body.description,
        })
        if (!checked.ok) {
          throw invalidWith(
            'The token is not valid.',
            'INVALID_TOKEN',
            checked.issues,
          )
        }
        const result = await tokens.upsert(getScope(res), brandId, {
          token: checked.token,
          ...(body.expectedVersion === undefined
            ? {}
            : { expectedVersion: body.expectedVersion }),
        })
        res.status(result.created ? 201 : 200).json({
          token: tokenView(result.token),
          draftRevision: result.draftRevision,
          warnings: checked.warnings.map(issueView),
        })
      },
    },

    {
      // expectedVersion travels in the QUERY STRING: a DELETE body has no defined
      // semantics (RFC 9110) and a proxy in the path may drop it.
      method: 'delete',
      path: `${BASE}/:path`,
      access: { orgRole: 'EDITOR' },
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const path = pathParam(req.params['path'])
        if (path.length > 200 || !PATH_PATTERN.test(path)) {
          throw new NotFoundError()
        }
        parseEmptyBody(req.body)
        const { expectedVersion } = parse(deleteQuery, req.query)
        const { draftRevision } = await tokens.remove(
          getScope(res),
          brandId,
          path,
          expectedVersion,
        )
        res.json({ draftRevision })
      },
    },
    {
      // Replace-only bulk import. The route has its OWN 512 KB body limit (the global
      // one is 16 KB); the body is parsed only after authentication, authorization
      // and the per-user rate limit (see RouteDef.bodyLimit).
      method: 'post',
      path: `${BASE}/import`,
      access: { orgRole: 'EDITOR' },
      after: [importLimiter],
      bodyLimit: IMPORT_BODY_LIMIT,
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const body = parse(importBody, req.body)
        const checked = validateImport(body.tree)
        if (!checked.ok) {
          throw invalidWith(
            'The import is not valid; nothing was changed.',
            'INVALID_IMPORT',
            checked.issues,
          )
        }
        const result = await tokens.replaceAll(
          getScope(res),
          brandId,
          checked.tokens,
          body.expectedRevision,
        )
        res.json({
          draftRevision: result.draftRevision,
          count: result.count,
          warnings: checked.warnings.map(issueView),
        })
      },
    },
  ]
}
