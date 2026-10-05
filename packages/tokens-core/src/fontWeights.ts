import type { FontWeight } from './types'

/**
 * DTCG Format Module 2025.10, section 8.4 "Font weight": the pre-defined string
 * values and the numbers they stand for. Names are case-sensitive.
 */
export const FONT_WEIGHT_NAMES: ReadonlyMap<string, number> = new Map([
  ['thin', 100],
  ['hairline', 100],
  ['extra-light', 200],
  ['ultra-light', 200],
  ['light', 300],
  ['normal', 400],
  ['regular', 400],
  ['book', 400],
  ['medium', 500],
  ['semi-bold', 600],
  ['demi-bold', 600],
  ['bold', 700],
  ['extra-bold', 800],
  ['ultra-bold', 800],
  ['black', 900],
  ['heavy', 900],
  ['extra-black', 950],
  ['ultra-black', 950],
])

export function isFontWeightName(name: string): boolean {
  return FONT_WEIGHT_NAMES.has(name)
}

/**
 * The numeric weight: a number in [1, 1000] is returned as is, a spec name is
 * converted, anything else is undefined.
 */
export function fontWeightToNumber(weight: FontWeight): number | undefined {
  if (typeof weight === 'number') {
    return Number.isFinite(weight) && weight >= 1 && weight <= 1000
      ? weight
      : undefined
  }
  return FONT_WEIGHT_NAMES.get(weight)
}
