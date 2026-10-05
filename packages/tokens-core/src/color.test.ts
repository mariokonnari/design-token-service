import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  flattenAlpha,
  parseHex,
  relativeLuminance,
  toHex,
  type Rgb,
} from './color'

function hex(value: string): Rgb {
  const parsed = parseHex(value)
  if (parsed === undefined) throw new Error(`bad test hex ${value}`)
  return parsed
}

describe('parseHex', () => {
  it('parses 6-digit hex into 0..1 components', () => {
    expect(parseHex('#000000')).toEqual([0, 0, 0])
    expect(parseHex('#ffffff')).toEqual([1, 1, 1])
    expect(parseHex('#ff8000')).toEqual([1, 128 / 255, 0])
  })

  it('is case-insensitive', () => {
    expect(parseHex('#ABCDEF')).toEqual(parseHex('#abcdef'))
  })

  it.each([
    '',
    '#fff',
    'ff00ff',
    '#ff00f',
    '#ff00ff0',
    '#ff00ff80',
    '#gg0000',
    ' #ff00ff',
    '#ff00ff ',
    '##ff00ff',
  ])('returns undefined for %j', (value) => {
    expect(parseHex(value)).toBeUndefined()
  })

  it('never throws on non-string input', () => {
    expect(parseHex(undefined as unknown as string)).toBeUndefined()
    expect(parseHex(null as unknown as string)).toBeUndefined()
  })
})

describe('toHex', () => {
  it('writes lowercase #rrggbb with 8-bit rounding', () => {
    expect(toHex([1, 0.5, 0])).toBe('#ff8000')
    expect(toHex([0.145, 0.388, 0.922])).toBe('#2563eb')
    expect(toHex([0, 0, 0])).toBe('#000000')
  })

  it('clamps out-of-range components and treats NaN as 0', () => {
    expect(toHex([2, -1, Number.NaN])).toBe('#ff0000')
  })

  it('round-trips every 8-bit value in each channel', () => {
    for (let byte = 0; byte < 256; byte++) {
      const pair = byte.toString(16).padStart(2, '0')
      for (const value of [`#${pair}0000`, `#00${pair}00`, `#0000${pair}`]) {
        expect(toHex(hex(value))).toBe(value)
      }
    }
  })
})

describe('relativeLuminance (WCAG 2.2)', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0)
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 10)
  })

  it('weights the primaries by 0.2126, 0.7152 and 0.0722', () => {
    expect(relativeLuminance([1, 0, 0])).toBeCloseTo(0.2126, 4)
    expect(relativeLuminance([0, 1, 0])).toBeCloseTo(0.7152, 4)
    expect(relativeLuminance([0, 0, 1])).toBeCloseTo(0.0722, 4)
  })

  it('uses the linear segment below the 0.04045 threshold', () => {
    expect(relativeLuminance([0.04, 0.04, 0.04])).toBeCloseTo(0.04 / 12.92, 10)
  })

  it('clamps out-of-range input', () => {
    expect(relativeLuminance([2, 2, 2])).toBeCloseTo(1, 10)
    expect(relativeLuminance([-1, -1, -1])).toBe(0)
  })
})

describe('contrastRatio (WCAG 2.x, opaque colors)', () => {
  const ratio = (a: string, b: string) => contrastRatio(hex(a), hex(b))

  it('is 21 for black on white and 1 for white on white', () => {
    expect(Math.abs(ratio('#000000', '#ffffff') - 21)).toBeLessThan(0.01)
    expect(Math.abs(ratio('#ffffff', '#ffffff') - 1)).toBeLessThan(0.01)
  })

  it('matches the reference values for #767676 and #777777 on white', () => {
    expect(Math.abs(ratio('#767676', '#ffffff') - 4.54)).toBeLessThan(0.01)
    expect(Math.abs(ratio('#777777', '#ffffff') - 4.48)).toBeLessThan(0.01)
  })

  it('does not depend on which argument is the foreground', () => {
    expect(ratio('#767676', '#ffffff')).toBe(ratio('#ffffff', '#767676'))
  })
})

describe('flattenAlpha', () => {
  const black: Rgb = [0, 0, 0]
  const white: Rgb = [1, 1, 1]

  it('returns the background for alpha 0 and the foreground for alpha 1', () => {
    expect(flattenAlpha({ components: black, alpha: 0 }, white)).toEqual(white)
    expect(flattenAlpha({ components: black, alpha: 1 }, white)).toEqual(black)
  })

  it('treats a missing or non-finite alpha as opaque', () => {
    expect(flattenAlpha({ components: black }, white)).toEqual(black)
    expect(
      flattenAlpha({ components: black, alpha: Number.NaN }, white),
    ).toEqual(black)
  })

  it('blends per channel in sRGB', () => {
    expect(flattenAlpha({ components: black, alpha: 0.5 }, white)).toEqual([
      0.5, 0.5, 0.5,
    ])
    expect(
      flattenAlpha({ components: [1, 0, 0], alpha: 0.25 }, [0, 0, 1]),
    ).toEqual([0.25, 0, 0.75])
  })

  it('clamps alpha to [0, 1]', () => {
    expect(flattenAlpha({ components: black, alpha: 2 }, white)).toEqual(black)
    expect(flattenAlpha({ components: black, alpha: -1 }, white)).toEqual(white)
  })

  it('does not mutate its inputs and returns a fresh array', () => {
    const fg: Rgb = [0.2, 0.4, 0.6]
    const bg: Rgb = [1, 1, 1]
    const out = flattenAlpha({ components: fg, alpha: 0.5 }, bg)
    expect(fg).toEqual([0.2, 0.4, 0.6])
    expect(bg).toEqual([1, 1, 1])
    expect(out).not.toBe(fg)
  })

  it('feeds contrast: 50% black over white is a mid grey (about 3.98:1)', () => {
    const flat = flattenAlpha({ components: black, alpha: 0.5 }, white)
    expect(Math.abs(contrastRatio(flat, white) - 3.98)).toBeLessThan(0.01)
  })
})

describe('property: contrastRatio', () => {
  const unit = fc.double({ min: 0, max: 1, noNaN: true })
  const rgb = fc.tuple(unit, unit, unit)

  it('is symmetric and always within [1, 21]', () => {
    fc.assert(
      fc.property(rgb, rgb, (a, b) => {
        const forward = contrastRatio(a, b)
        expect(forward).toBe(contrastRatio(b, a))
        expect(forward).toBeGreaterThanOrEqual(1)
        expect(forward).toBeLessThanOrEqual(21)
      }),
      { numRuns: 100 },
    )
  })
})
