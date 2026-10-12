import { flatten, type Issue, type Token } from '@dts/tokens-core'
import { guardTree } from './treeGuard'
import { LIMITS, validateSingleToken } from './validateWrite'

/**
 * Validates an untrusted import tree (ADR 0014). In order:
 *  1. guardTree: depth, object count and reserved names, on an iterative walk, BEFORE
 *     tokens-core sees it (flatten is quadratic in depth);
 *  2. flatten (tokens-core): every format rule;
 *  3. at least one token (a replace with nothing would wipe the draft by accident)
 *     and at most 2000;
 *  4. every token again through validateSingleToken, so an import obeys exactly the
 *     per-token limits a PUT does (path 200, value 8192 bytes, description 500).
 * ANY error refuses the whole import. Warnings are returned. Never throws.
 */
export type ImportValidation =
  | { ok: true; tokens: Token[]; warnings: Issue[] }
  | { ok: false; issues: Issue[] }

const fail = (message: string): ImportValidation => ({
  ok: false,
  issues: [
    {
      code: 'INVALID_STRUCTURE',
      severity: 'error',
      path: '',
      message,
    },
  ],
})

export function validateImport(tree: unknown): ImportValidation {
  const shape = guardTree(tree)
  if (shape.length > 0) return { ok: false, issues: shape }

  const flat = flatten(tree)
  const errors = flat.issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) return { ok: false, issues: flat.issues }

  if (flat.tokens.length === 0) {
    return fail(
      'The import contains no tokens, so it would only empty the draft.',
    )
  }
  if (flat.tokens.length > LIMITS.MAX_TOKENS_PER_BRAND) {
    return fail(
      `A brand may have at most ${LIMITS.MAX_TOKENS_PER_BRAND} tokens (the import has ${flat.tokens.length}).`,
    )
  }

  const limitIssues: Issue[] = []
  for (const token of flat.tokens) {
    const checked = validateSingleToken({
      path: token.path,
      type: token.type,
      value: 'alias' in token ? `{${token.alias}}` : token.value,
      description: token.description,
    })
    if (!checked.ok) limitIssues.push(...checked.issues)
  }
  if (limitIssues.length > 0) return { ok: false, issues: limitIssues }

  return { ok: true, tokens: flat.tokens, warnings: flat.issues }
}
