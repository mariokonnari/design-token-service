import {
  checkTiers,
  comparePaths,
  resolve,
  toCssVariables,
  type ResolvedToken,
  type Token,
} from '@dts/tokens-core'
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

export interface DraftValidation {
  issues: DraftIssue[]
  /** At least one token and no error-severity issue. */
  publishable: boolean
}

const tierRule: Rule = ({ tokens }) => checkTiers(tokens)

const cssNameRule: Rule = ({ resolved }) => toCssVariables(resolved).issues

export const DEFAULT_RULES: readonly Rule[] = [tierRule, cssNameRule]

export function validateDraft(
  rows: readonly TokenRowInput[],
  rules: readonly Rule[] = DEFAULT_RULES,
): DraftValidation {
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
