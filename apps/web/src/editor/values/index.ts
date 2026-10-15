import type { Token } from '@dts/tokens-core'
import { formatAlias } from './alias'
import { formatColor } from './color'
import { formatDimension } from './dimension'
import { formatFontFamily } from './fontFamily'
import { formatFontWeight } from './fontWeight'
import { formatNumber } from './number'

/**
 * A token's value as TEXT, for lists and read-only views. The value is always shown
 * as text (a swatch next to it is decoration), so colour is never the only signal.
 */
export function formatTokenValue(token: Token): string {
  if ('alias' in token) return formatAlias(token.alias)
  switch (token.type) {
    case 'color': {
      const { hex, alpha } = formatColor(token.value)
      return alpha === '' ? hex : `${hex} (alpha ${alpha})`
    }
    case 'dimension':
      return formatDimension(token.value)
    case 'fontFamily':
      return formatFontFamily(token.value)
    case 'fontWeight':
      return formatFontWeight(token.value)
    case 'number':
      return formatNumber(token.value)
  }
}
