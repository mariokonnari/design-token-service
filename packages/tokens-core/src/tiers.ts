import { error, sortIssues } from './issues'
import { splitPath } from './names'
import type { Issue, Token } from './types'

/** The top-level groups of a token document. */
export const TIERS = ['primitive', 'semantic', 'component'] as const

export type Tier = (typeof TIERS)[number]

/**
 * Which tiers a token of each tier may alias. Primitives are literals only.
 * Semantic and component tokens may also hold literals (a policy that may
 * tighten later, see ADR 0006).
 */
const ALLOWED_TARGETS: Record<Tier, readonly Tier[]> = {
  primitive: [],
  semantic: ['primitive', 'semantic'],
  component: ['semantic', 'component'],
}

/** The tier a path belongs to: its first segment, if the token sits inside a tier group. */
export function tierOf(path: string): Tier | undefined {
  const [first, ...rest] = splitPath(path)
  if (rest.length === 0) return undefined
  return TIERS.find((tier) => tier === first)
}

/**
 * Checks the tier rules on direct alias edges. This is deliberately separate
 * from `resolve()`: it needs neither the target to exist nor a resolved value.
 */
export function checkTiers(tokens: readonly Token[]): Issue[] {
  const issues: Issue[] = []

  for (const token of tokens) {
    const tier = tierOf(token.path)
    if (tier === undefined) {
      issues.push(
        error(
          'TIER_VIOLATION',
          token.path,
          `Tokens must live inside one of the top-level groups ${TIERS.join(', ')}`,
        ),
      )
      continue
    }
    if (!('alias' in token)) continue

    if (tier === 'primitive') {
      issues.push(
        error(
          'TIER_VIOLATION',
          token.path,
          'Primitive tokens must be literal values, not aliases',
          { field: '$value', related: [token.alias] },
        ),
      )
      continue
    }

    const targetTier = tierOf(token.alias)
    // An unknown target tier is reported on the target token itself.
    if (
      targetTier !== undefined &&
      !ALLOWED_TARGETS[tier].includes(targetTier)
    ) {
      issues.push(
        error(
          'TIER_VIOLATION',
          token.path,
          `${tier} tokens may only alias ${ALLOWED_TARGETS[tier].join(' or ')} tokens, but "${token.alias}" is ${targetTier}`,
          { field: '$value', related: [token.alias] },
        ),
      )
    }
  }

  return sortIssues(issues)
}
