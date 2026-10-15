import type { Dimension } from '@dts/tokens-core'
import { bad, cleanInput, good, type Parsed } from './result'

const DIMENSION = /^(-?\d{1,9}(?:\.\d{1,9})?)(px|rem)$/

export function parseDimension(text: string): Parsed<Dimension> {
  const input = cleanInput(text)
  const match = input === undefined ? null : DIMENSION.exec(input)
  if (match === null) {
    return bad('Enter a size like 16px or 1.5rem (px or rem).')
  }
  const value = Number(match[1]) + 0 // + 0 turns -0 into 0
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
    return bad('That size is too large.')
  }
  return good({ value, unit: match[2] as Dimension['unit'] })
}

export function formatDimension(value: Dimension): string {
  return `${value.value}${value.unit}`
}
