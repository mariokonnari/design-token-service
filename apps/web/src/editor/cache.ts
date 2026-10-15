import { comparePaths } from '@dts/tokens-core'
import type { ServerToken, TokenList } from '../api/types'

/**
 * Pure updates of the cached token list after a write, so the screen follows the
 * server's answer without another round trip. Other tokens keep their versions: a
 * write changes only its own token's version, and a stale one is caught by the
 * server's `expectedVersion` check.
 */
export function withSavedToken(
  list: TokenList,
  saved: ServerToken,
  draftRevision: number,
): TokenList {
  const tokens = list.tokens.filter((token) => token.path !== saved.path)
  tokens.push(saved)
  tokens.sort((a, b) => comparePaths(a.path, b.path))
  return { draftRevision, tokens }
}

export function withoutToken(
  list: TokenList,
  path: string,
  draftRevision: number,
): TokenList {
  return {
    draftRevision,
    tokens: list.tokens.filter((token) => token.path !== path),
  }
}
