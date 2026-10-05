import { describe, expect, it } from 'vitest'
import {
  FONT_WEIGHT_NAMES,
  fontWeightToNumber,
  isFontWeightName,
} from './fontWeights'

// Transcribed from DTCG Format Module 2025.10, section 8.4 "Font weight".
const SPEC_TABLE: [number, string[]][] = [
  [100, ['thin', 'hairline']],
  [200, ['extra-light', 'ultra-light']],
  [300, ['light']],
  [400, ['normal', 'regular', 'book']],
  [500, ['medium']],
  [600, ['semi-bold', 'demi-bold']],
  [700, ['bold']],
  [800, ['extra-bold', 'ultra-bold']],
  [900, ['black', 'heavy']],
  [950, ['extra-black', 'ultra-black']],
]

const SPEC_ROWS = SPEC_TABLE.flatMap(([value, names]) =>
  names.map((name): [string, number] => [name, value]),
)

describe('FONT_WEIGHT_NAMES (DTCG 2025.10 section 8.4)', () => {
  it.each(SPEC_ROWS)('maps %j to %d', (name, value) => {
    expect(FONT_WEIGHT_NAMES.get(name)).toBe(value)
    expect(fontWeightToNumber(name)).toBe(value)
    expect(isFontWeightName(name)).toBe(true)
  })

  it('contains exactly the names in the spec table and no others', () => {
    expect(SPEC_ROWS).toHaveLength(18)
    expect([...FONT_WEIGHT_NAMES.keys()].sort()).toEqual(
      SPEC_ROWS.map(([name]) => name).sort(),
    )
  })

  it('is case-sensitive', () => {
    expect(fontWeightToNumber('Bold')).toBeUndefined()
    expect(isFontWeightName('BOLD')).toBe(false)
  })

  it('does not treat Object.prototype members as names', () => {
    expect(fontWeightToNumber('constructor')).toBeUndefined()
    expect(isFontWeightName('toString')).toBe(false)
  })
})

describe('fontWeightToNumber', () => {
  it.each([1, 350, 400, 1000])('passes the in-range number %d through', (n) => {
    expect(fontWeightToNumber(n)).toBe(n)
  })

  it.each([0, 1001, -5, Number.NaN, Infinity])(
    'returns undefined for the out-of-range number %d',
    (n) => {
      expect(fontWeightToNumber(n)).toBeUndefined()
    },
  )

  it.each(['400', '', 'semibold', 'extra bold'])(
    'returns undefined for the unknown name %j',
    (name) => {
      expect(fontWeightToNumber(name)).toBeUndefined()
    },
  )
})
