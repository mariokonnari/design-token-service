import { nest, type NestResult } from './tree'
import type { LiteralToken, ResolvedToken } from './types'

/**
 * Builds a nested DTCG-shaped tree of literal tokens from resolved tokens.
 * Aliases are gone: every token carries its resolved `$value`. Font weight
 * names stay as written (only the CSS export converts them to numbers).
 * Built with `nest()`, so it has the same issues (INVALID_NAME, PATH_CONFLICT)
 * and key order.
 */
export function toResolvedTree(resolved: readonly ResolvedToken[]): NestResult {
  const literals = resolved.map((token) => {
    const literal = {
      path: token.path,
      type: token.type,
      value: token.value,
    } as LiteralToken
    if (token.description !== undefined) literal.description = token.description
    return literal
  })
  return nest(literals)
}
