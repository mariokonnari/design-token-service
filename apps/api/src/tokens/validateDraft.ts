import {
  checkTiers,
  comparePaths,
  nest,
  resolve,
  toCssVariables,
  type ResolvedToken,
  type Token,
} from '@dts/tokens-core'
import { RELEASE_LIMITS } from '../releases/limits'
import { rowToToken, type DraftIssue, type TokenRowInput } from './mapper'

/**
 * Draft validation: PURE (rows in, issues out), so the future publish step can reuse
 * it unchanged (ADR 0014). A draft may be invalid while it is being edited
 * (ADR 0012); this is where "may be" becomes "is".
 *
 * Pipeline: rows -> mapper (corrupt rows become UNMAPPABLE_ROW and are passed to
 * `resolve` as `rejected`, so an alias to one is ALIAS_TARGET_INVALID rather than
 * "missing") -> `resolve` (missing targets, cycles, type mismatches) -> RULES.
 *
 * HOW TO ADD A RULE (e.g. the Phase 5 contrast gate): write a `Rule`, a function of
 * the tokens, the resolved tokens and the rejected paths that returns issues, and
 * pass `[...DEFAULT_RULES, contrastRule]` as the second argument. Callers of
 * `validateDraft` and the shape of the result do not change; a rule's error-severity
 * issues make the draft unpublishable like any other. A rule that throws is caught
 * and reported as one RULE_FAILED error, so a bug in a rule blocks publishing instead
 * of crashing the request (fail closed).
 *
 * WHAT A RELEASE NEEDS (ADR 0015) is part of the default rules, so `GET /validate` and
 * publish always agree:
 * - NOTHING_TO_EXPORT: every token resolved, but no semantic or component token exports
 *   (a primitives-only draft would publish an empty stylesheet). Not reported for drafts
 *   that already have a more specific problem (empty, unresolved, only unmappable rows);
 * - RELEASE_TOO_LARGE: snapshot bytes + CSS bytes (root scope, semantic + component)
 *   above `MAX_RELEASE_BYTES`. The CSS side matters: aliases multiply a big value.
 *   Because that exact measure needs resolve + CSS (about 0.7 s at the worst case the
 *   per-token limits allow), `validateDraft` first sums the RAW stored bytes (values,
 *   descriptions, paths; O(n), about 35 ms at the worst case) and returns at once when
 *   they already exceed the cap. For rows written through the API this is a lower
 *   bound of the snapshot (stored values are the validated, normalized ones), so it
 *   never rejects a draft the exact rule would accept; for a hand-edited row it is
 *   simply a conservative reading of "too large".
 *
 * Limits: O(n) in the number of tokens (at most 2000), CSS-name collisions are only
 * detected among tokens that RESOLVED (an unresolved token has no value to export).
 */

export interface RuleContext {
  readonly tokens: readonly Token[]
  readonly resolved: readonly ResolvedToken[]
  /** Paths of stored rows that could not be mapped to a token. */
  readonly rejected: readonly string[]
}

export type Rule = (context: RuleContext) => readonly DraftIssue[]

export interface ValidateOptions {
  /** Overrides the release size cap (tests use small caps); default `MAX_RELEASE_BYTES`. */
  maxReleaseBytes?: number
}

export interface DraftValidation {
  issues: DraftIssue[]
  /** At least one token and no error-severity issue. */
  publishable: boolean
}

const tierRule: Rule = ({ tokens }) => checkTiers(tokens)

const cssNameRule: Rule = ({ resolved }) => toCssVariables(resolved).issues

interface ExportArtifacts {
  snapshotBytes: number
  css: string
  cssBytes: number
}

/** What a release stores, measured once per validation (both release rules need it). */
const artifactCache = new WeakMap<RuleContext, ExportArtifacts>()

function exportArtifacts(context: RuleContext): ExportArtifacts {
  const cached = artifactCache.get(context)
  if (cached !== undefined) return cached
  const { css } = toCssVariables(context.resolved, {
    include: ['semantic', 'component'],
  })
  const artifacts = {
    snapshotBytes: Buffer.byteLength(JSON.stringify(nest(context.tokens).tree)),
    css,
    cssBytes: Buffer.byteLength(css),
  }
  artifactCache.set(context, artifacts)
  return artifacts
}

const nothingToExportRule: Rule = (context) => {
  // Only when everything resolved: otherwise a more specific issue already blocks.
  if (
    context.tokens.length === 0 ||
    context.resolved.length !== context.tokens.length
  ) {
    return []
  }
  if (exportArtifacts(context).css !== '') return []
  return [
    {
      code: 'NOTHING_TO_EXPORT',
      severity: 'error',
      path: '',
      message:
        'No semantic or component token exports a value, so a release would be an empty stylesheet. Add semantic or component tokens.',
    },
  ]
}

function tooLargeIssue(message: string): DraftIssue {
  return { code: 'RELEASE_TOO_LARGE', severity: 'error', path: '', message }
}

function releaseSizeRule(maxBytes: number): Rule {
  return (context) => {
    if (context.tokens.length === 0) return []
    const { snapshotBytes, cssBytes } = exportArtifacts(context)
    const size = snapshotBytes + cssBytes
    if (size <= maxBytes) return []
    return [
      tooLargeIssue(
        `The release would be ${size} bytes (snapshot ${snapshotBytes} + CSS ${cssBytes}); the limit is ${maxBytes}.`,
      ),
    ]
  }
}

export function defaultRules(
  maxReleaseBytes: number = RELEASE_LIMITS.MAX_RELEASE_BYTES,
): readonly Rule[] {
  return [
    tierRule,
    cssNameRule,
    nothingToExportRule,
    releaseSizeRule(maxReleaseBytes),
  ]
}

export const DEFAULT_RULES: readonly Rule[] = defaultRules()

/** Raw stored bytes of the draft: values, descriptions and paths. O(n), no token parsing. */
function rawStoredBytes(rows: readonly TokenRowInput[]): number {
  let total = 0
  for (const row of rows) {
    let encoded: string | undefined
    try {
      encoded = JSON.stringify(row.value)
    } catch {
      encoded = undefined // unserializable: the mapper reports the row
    }
    total += Buffer.byteLength(encoded ?? '')
    total += Buffer.byteLength(row.description ?? '')
    total += Buffer.byteLength(typeof row.path === 'string' ? row.path : '')
  }
  return total
}

export function validateDraft(
  rows: readonly TokenRowInput[],
  rules: readonly Rule[] = DEFAULT_RULES,
  options: ValidateOptions = {},
): DraftValidation {
  const maxReleaseBytes =
    options.maxReleaseBytes ?? RELEASE_LIMITS.MAX_RELEASE_BYTES
  const stored = rawStoredBytes(rows)
  if (stored > maxReleaseBytes) {
    // Short-circuit: do not map, resolve or run rules over an oversized draft.
    return {
      issues: [
        tooLargeIssue(
          `The draft stores ${stored} bytes of values, descriptions and paths, more than the release limit of ${maxReleaseBytes} bytes. Shrink it first.`,
        ),
      ],
      publishable: false,
    }
  }

  const issues: DraftIssue[] = []
  const tokens: Token[] = []
  const rejected: string[] = []

  for (const row of rows) {
    const mapped = rowToToken(row)
    if (mapped.ok) {
      tokens.push(mapped.token)
      issues.push(...mapped.warnings)
    } else {
      rejected.push(mapped.issue.path)
      issues.push(mapped.issue)
    }
  }

  if (rows.length === 0) {
    issues.push({
      code: 'EMPTY_DRAFT',
      severity: 'error',
      path: '',
      message: 'The draft has no tokens, so there is nothing to publish.',
    })
  }

  const { resolved, issues: resolveIssues } = resolve(tokens, { rejected })
  issues.push(...resolveIssues)

  const context: RuleContext = { tokens, resolved, rejected }
  for (const rule of rules) {
    try {
      issues.push(...rule(context))
    } catch {
      issues.push({
        code: 'RULE_FAILED',
        severity: 'error',
        path: '',
        message:
          'A validation rule failed to run, so the draft is not publishable.',
      })
    }
  }

  issues.sort(
    (a, b) =>
      comparePaths(a.path, b.path) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  )
  return {
    issues,
    publishable: !issues.some((issue) => issue.severity === 'error'),
  }
}
