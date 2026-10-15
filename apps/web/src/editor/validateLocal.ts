import {
  checkTiers,
  resolve,
  tierOf,
  type Issue,
  type Token,
} from '@dts/tokens-core'
import { LIMITS } from './limits'

/**
 * Local checks on the working copy, for instant feedback while typing (ADR 0017).
 * They are NOT the publish gate: the result has no "publishable" notion and the UI
 * says "Looks valid here". Only the server's /validate says whether a draft can be
 * published. They cover: the tiers, name clashes (a token cannot also be a group),
 * the token limit, and alias targets and cycles on the working copy.
 */
export interface LocalProblem {
  field: 'path' | 'type' | 'value' | 'alias' | 'general'
  message: string
}

function fromIssue(issue: Issue): LocalProblem {
  switch (issue.code) {
    case 'ALIAS_NOT_FOUND':
      return {
        field: 'alias',
        message:
          'No token has this path. Check the spelling, or create it first.',
      }
    case 'ALIAS_TARGET_INVALID':
      return {
        field: 'alias',
        message: 'The token this alias points to is not valid.',
      }
    case 'ALIAS_CYCLE':
      return {
        field: 'alias',
        message:
          'This alias leads back to itself, directly or through other tokens.',
      }
    case 'TYPE_MISMATCH':
      return { field: 'type', message: issue.message }
    case 'TIER_VIOLATION':
      return { field: 'alias', message: issue.message }
    default:
      return { field: 'general', message: issue.message }
  }
}

/**
 * `others` is the working copy (it may still hold the OLD version of the candidate,
 * which is ignored). `isNew` is true when the candidate is being created.
 */
export function validateLocal(
  candidate: Token,
  others: readonly Token[],
  isNew: boolean,
): LocalProblem[] {
  const problems: LocalProblem[] = []
  const { path } = candidate
  const rest = others.filter((token) => token.path !== path)

  if (tierOf(path) === undefined) {
    problems.push({
      field: 'path',
      message: 'A path starts with primitive, semantic or component.',
    })
  }

  if (isNew && rest.length !== others.length) {
    problems.push({
      field: 'path',
      message: 'A token with this path already exists.',
    })
  }

  const clash = rest.find(
    (token) =>
      token.path.startsWith(`${path}.`) || path.startsWith(`${token.path}.`),
  )
  if (clash !== undefined) {
    problems.push({
      field: 'path',
      message: `A token cannot also be a group: "${clash.path}" overlaps with this path.`,
    })
  }

  if (isNew && rest.length >= LIMITS.maxTokens) {
    problems.push({
      field: 'general',
      message: `A brand can have at most ${LIMITS.maxTokens} tokens.`,
    })
  }

  if (tierOf(path) !== undefined) {
    for (const issue of checkTiers([candidate])) problems.push(fromIssue(issue))
  }

  if ('alias' in candidate) {
    const { issues } = resolve([...rest, candidate])
    const seen = new Set<string>()
    for (const issue of issues) {
      const mine =
        issue.path === path ||
        (issue.code === 'ALIAS_CYCLE' && issue.related?.includes(path) === true)
      if (!mine) continue
      const problem = fromIssue(issue)
      const key = `${problem.field}|${problem.message}`
      if (seen.has(key)) continue
      seen.add(key)
      problems.push(problem)
    }
  }
  return problems
}
