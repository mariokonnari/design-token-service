import { comparePaths, tierOf } from '@dts/tokens-core'

/**
 * How much of the component library's theme a draft defines (ADR 0017).
 *
 * The library (`@dts/ui`) reads semantic and component variables and has NO var()
 * fallbacks, so a library variable the draft does not define is simply unset in the
 * published CSS. The catalogue of those variables is the semantic and component
 * paths of the starter template (`default.tokens.json`). This is a plain set
 * difference on paths: it does not judge values, and it is advice only (publishing
 * does not enforce it).
 */
export interface LibraryCoverage {
  /** Library paths the draft defines. */
  defined: number
  /** Library paths in total (the starter's semantic and component tokens). */
  total: number
  /** Library paths the draft lacks, in token order. */
  missing: string[]
}

export function libraryCoverage(
  tokens: readonly { path: string }[],
  starterTokens: readonly { path: string }[],
): LibraryCoverage {
  const library = new Set<string>()
  for (const { path } of starterTokens) {
    const tier = tierOf(path)
    if (tier === 'semantic' || tier === 'component') library.add(path)
  }
  const have = new Set(tokens.map((token) => token.path))
  const missing = [...library]
    .filter((path) => !have.has(path))
    .sort(comparePaths)
  return {
    defined: library.size - missing.length,
    total: library.size,
    missing,
  }
}
