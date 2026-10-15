import { flatten, type Token } from '@dts/tokens-core'
// The library's own token file, the source of its theme CSS (ADR 0008). It is
// bundled into the editor as the "start from the default theme" template and as the
// catalogue of tokens the library consumes.
import starterTree from '@dts/ui/tokens/default.tokens.json'

/** The starter document, as the API's import endpoint expects it (a DTCG tree). */
export const STARTER_TREE: unknown = starterTree

/** The starter as tokens-core tokens, sorted by path. */
export const STARTER_TOKENS: readonly Token[] = flatten(STARTER_TREE).tokens
