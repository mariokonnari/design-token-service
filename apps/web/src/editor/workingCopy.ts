import { comparePaths, type Token } from '@dts/tokens-core'
import type { Entry } from './rows'

/**
 * The working copy is the server's tokens plus an overlay of unsaved changes keyed
 * by path. The data structure allows many entries; the UI uses at most ONE dirty
 * entry (selecting another token while it is dirty asks "Discard changes?"), so
 * unsaved edits cannot pile up out of sight (ADR 0017).
 */
export type OverlayEntry =
  | { kind: 'edit'; token: Token }
  | { kind: 'add'; token: Token }
  | { kind: 'delete' }

export type Overlay = ReadonlyMap<string, OverlayEntry>

export const NO_OVERLAY: Overlay = new Map()

/** The tokens as they would be if the overlay were saved, sorted by path. Does not change its input. */
export function workingTokens(
  base: readonly Entry[],
  overlay: Overlay,
): Token[] {
  const result = new Map<string, Token>()
  for (const { token } of base) result.set(token.path, token)
  for (const [path, entry] of overlay) {
    if (entry.kind === 'delete') result.delete(path)
    else result.set(path, entry.token)
  }
  return [...result.values()].sort((a, b) => comparePaths(a.path, b.path))
}
