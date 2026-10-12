import { createHash } from 'node:crypto'
import { nest, resolve, toCssVariables, type TokenTree } from '@dts/tokens-core'
import {
  rowToToken,
  type DraftIssue,
  type TokenRowInput,
} from '../tokens/mapper'
import { validateDraft } from '../tokens/validateDraft'

/**
 * Builds a release from the draft rows (ADR 0015). PURE: rows and a brand slug in,
 * snapshot + CSS + hash out; no I/O, so the same input always gives the same bytes
 * (everything is sorted by path) and the repository can call it under the brand lock.
 *
 * It runs `validateDraft` with the DEFAULT rules first, so a release is built only from
 * a draft that GET /validate calls publishable (including the size cap and the
 * "something must export" rule). It then fails CLOSED: if anything it computes
 * disagrees with the validation (an issue from `nest` or the exporter, an empty
 * stylesheet), the draft is not published.
 *
 * - snapshot: the SOURCE tree (`nest`): aliases stay aliases, descriptions are kept;
 * - css: `toCssVariables` of the resolved tokens, scoped to `[data-theme="<slug>"]`,
 *   semantic and component tiers only (components never read primitives, ADR 0002);
 * - cssSha256: sha256 (lowercase hex) of the css text.
 *
 * CPU: synchronous. Measured for 2000 tokens in ADR 0015; it blocks the event loop.
 */

export type BuildResult =
  | { ok: true; snapshot: TokenTree; css: string; cssSha256: string }
  | { ok: false; issues: DraftIssue[] }

export function buildRelease(
  rows: readonly TokenRowInput[],
  brandSlug: string,
): BuildResult {
  const validation = validateDraft(rows)
  if (!validation.publishable) return { ok: false, issues: validation.issues }

  const tokens = rows.flatMap((row) => {
    const mapped = rowToToken(row)
    return mapped.ok ? [mapped.token] : []
  })
  const { tree, issues: nestIssues } = nest(tokens)
  const { resolved, issues: resolveIssues } = resolve(tokens)
  const { css, issues: cssIssues } = toCssVariables(resolved, {
    scope: { kind: 'attribute', name: 'data-theme', value: brandSlug },
    include: ['semantic', 'component'],
  })

  const problems = [...nestIssues, ...resolveIssues, ...cssIssues].filter(
    (issue) => issue.severity === 'error',
  )
  if (problems.length > 0) return { ok: false, issues: problems }
  if (css === '') {
    return {
      ok: false,
      issues: [
        {
          code: 'NOTHING_TO_EXPORT',
          severity: 'error',
          path: '',
          message: 'The stylesheet would be empty.',
        },
      ],
    }
  }
  return {
    ok: true,
    snapshot: tree,
    css,
    cssSha256: createHash('sha256').update(css).digest('hex'),
  }
}
