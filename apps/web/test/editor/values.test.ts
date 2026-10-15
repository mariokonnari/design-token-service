import type { SrgbColor } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { formatAlias, parseAliasText } from '../../src/editor/values/alias'
import { formatColor, parseColor } from '../../src/editor/values/color'
import {
  formatDimension,
  parseDimension,
} from '../../src/editor/values/dimension'
import {
  formatFontFamily,
  parseFontFamily,
} from '../../src/editor/values/fontFamily'
import {
  formatFontWeight,
  parseFontWeight,
} from '../../src/editor/values/fontWeight'
import { formatNumber, parseNumber } from '../../src/editor/values/number'

// Pure parse/format pairs for the value editors. Each returns
// { ok: true, value } or { ok: false, message }; nothing throws, whatever is typed.

/** Must fail for every kind of value. */
const COMMON = ['', '   ', 'x'.repeat(10_000), '\u0000', 'a\nb']
/** Numbers that are not finite or are absurdly large. */
const NUMERIC = ['1e999', 'NaN', 'Infinity', '-Infinity', '9'.repeat(400)]
/** Strings that are names or markup, never a color, dimension, weight or number. */
const NAMEY = [
  '__proto__',
  'constructor',
  '<script>alert(1)</script>',
  '\u202e',
]
const HOSTILE = [...COMMON, ...NUMERIC, ...NAMEY]

describe('color', () => {
  it('parses #rrggbb, #rgb and upper case, trimming spaces', () => {
    const blue = parseColor('#2563eb', '')
    expect(blue).toEqual({
      ok: true,
      value: {
        colorSpace: 'srgb',
        components: [0x25 / 255, 0x63 / 255, 0xeb / 255],
      },
    })
    expect(parseColor('#FFF', '')).toEqual({
      ok: true,
      value: { colorSpace: 'srgb', components: [1, 1, 1] },
    })
    expect(parseColor('  #2563EB  ', '')).toEqual(blue)
  })

  it.each([
    '#ffff',
    '#12345',
    '#1234567',
    '#rrggbb',
    '#12345g',
    '2563eb',
    'red',
    'rgb(0,0,0)',
    '#2563eb80',
  ])(
    'refuses %j (#rrggbbaa is not accepted: alpha is its own field)',
    (hex) => {
      expect(parseColor(hex, '').ok).toBe(false)
    },
  )

  it('alpha: empty and 1 mean opaque (no alpha key), 0..1 is kept, anything else is refused', () => {
    const opaque = parseColor('#000', '')
    expect(opaque.ok && 'alpha' in opaque.value).toBe(false)
    const one = parseColor('#000', '1')
    expect(one.ok && 'alpha' in one.value).toBe(false)
    expect(parseColor('#000', '0.5')).toMatchObject({
      ok: true,
      value: { alpha: 0.5 },
    })
    expect(parseColor('#000', '0')).toMatchObject({
      ok: true,
      value: { alpha: 0 },
    })
    for (const bad of [
      '1.5',
      '-0.1',
      'NaN',
      '1e-1',
      '50%',
      'half',
      '0,5',
      '2',
    ]) {
      expect(parseColor('#000', bad).ok, bad).toBe(false)
    }
  })

  it('an unchanged hex keeps the original, unrounded components (they stay the source of truth)', () => {
    const original: SrgbColor = {
      colorSpace: 'srgb',
      components: [0.145, 0.388, 0.922],
    }
    const result = parseColor('#2563eb', '', original)
    expect(result.ok && result.value.components).toEqual([0.145, 0.388, 0.922])
    // a different hex replaces them
    const changed = parseColor('#2563ec', '', original)
    expect(changed.ok && changed.value.components).not.toEqual(
      original.components,
    )
  })

  it('never writes the hex fallback key', () => {
    const original: SrgbColor = {
      colorSpace: 'srgb',
      components: [0, 0, 0],
      hex: '#000000',
    }
    const result = parseColor('#000000', '', original)
    expect(result.ok && 'hex' in result.value).toBe(false)
  })

  it('formats back to lowercase hex and an alpha text', () => {
    expect(
      formatColor({ colorSpace: 'srgb', components: [0.145, 0.388, 0.922] }),
    ).toEqual({ hex: '#2563eb', alpha: '' })
    expect(
      formatColor({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.25 }),
    ).toEqual({ hex: '#000000', alpha: '0.25' })
    expect(
      formatColor({ colorSpace: 'srgb', components: [1, 1, 1], alpha: 1 }),
    ).toEqual({ hex: '#ffffff', alpha: '' })
  })

  it.each(HOSTILE)('hostile hex %j never throws', (text) => {
    expect(() => parseColor(text, text)).not.toThrow()
    expect(parseColor(text, '').ok).toBe(false)
  })
})

describe('dimension', () => {
  it.each([
    ['16px', { value: 16, unit: 'px' }],
    ['1.5rem', { value: 1.5, unit: 'rem' }],
    ['-4px', { value: -4, unit: 'px' }],
    ['0px', { value: 0, unit: 'px' }],
    ['  8px ', { value: 8, unit: 'px' }],
  ])('parses %j', (text, value) => {
    expect(parseDimension(text)).toEqual({ ok: true, value })
  })

  it.each([
    '16',
    '16em',
    '16 px',
    '1e3px',
    '.5px',
    '5.px',
    '+5px',
    '--5px',
    'px',
    '16PX',
    '99999999999999px',
    ...HOSTILE,
  ])('refuses %j', (text) => {
    expect(parseDimension(text).ok).toBe(false)
  })

  it('formats value and unit', () => {
    expect(formatDimension({ value: 1.5, unit: 'rem' })).toBe('1.5rem')
    expect(formatDimension({ value: -4, unit: 'px' })).toBe('-4px')
  })

  it('round trips', () => {
    for (const text of ['16px', '0.25rem', '-3px']) {
      const parsed = parseDimension(text)
      expect(parsed.ok && formatDimension(parsed.value)).toBe(text)
    }
  })
})

describe('fontFamily', () => {
  it.each([
    ['Inter', 'Inter'],
    ['Inter, sans-serif', ['Inter', 'sans-serif']],
    ['"Helvetica Neue", Arial', ['Helvetica Neue', 'Arial']],
    ["'A B', c", ['A B', 'c']],
    ['Helvetica Neue', 'Helvetica Neue'],
    ['"He said \\"hi\\""', 'He said "hi"'],
    ['"a, b", c', ['a, b', 'c']],
    ['  Inter ,  Arial  ', ['Inter', 'Arial']],
  ])('parses %j', (text, value) => {
    expect(parseFontFamily(text)).toEqual({ ok: true, value })
  })

  it.each([
    'a,,b',
    'a,',
    ',a',
    '"unclosed',
    "'unclosed",
    'a"b',
    '"a"b',
    '"a" "b"',
    'a\\b',
    '"a\\q"',
    'a,\u0000',
    ...COMMON,
  ])('refuses %j', (text) => {
    expect(parseFontFamily(text).ok).toBe(false)
  })

  it('formats: quotes only the names that need it, escaping quotes and backslashes', () => {
    expect(formatFontFamily('Inter')).toBe('Inter')
    expect(formatFontFamily(['Helvetica Neue', 'sans-serif'])).toBe(
      'Helvetica Neue, sans-serif',
    )
    expect(formatFontFamily(['a, b', 'c'])).toBe('"a, b", c')
    expect(formatFontFamily('He said "hi"')).toBe('"He said \\"hi\\""')
    expect(formatFontFamily('back\\slash')).toBe('"back\\\\slash"')
    expect(formatFontFamily(' padded ')).toBe('" padded "')
  })

  it('round trips names with awkward characters', () => {
    for (const value of [
      'Inter',
      ['a, b', "it's", 'say "x"', 'back\\slash', ' padded '],
    ]) {
      const parsed = parseFontFamily(formatFontFamily(value))
      expect(parsed, JSON.stringify(value)).toEqual({ ok: true, value })
    }
  })
})

describe('fontWeight', () => {
  it.each([
    ['400', 400],
    ['1', 1],
    ['1000', 1000],
    ['550.5', 550.5],
    ['bold', 'bold'],
    ['semi-bold', 'semi-bold'],
    [' normal ', 'normal'],
  ])('parses %j', (text, value) => {
    expect(parseFontWeight(text)).toEqual({ ok: true, value })
  })

  it.each(['0', '1001', '-5', 'Bold', 'bolder', '1e3', '40 0', ...HOSTILE])(
    'refuses %j',
    (text) => {
      expect(parseFontWeight(text).ok).toBe(false)
    },
  )

  it('formats numbers and names', () => {
    expect(formatFontWeight(700)).toBe('700')
    expect(formatFontWeight('bold')).toBe('bold')
  })
})

describe('number', () => {
  it.each([
    ['1.618', 1.618],
    ['-2', -2],
    ['0', 0],
    [' 3 ', 3],
  ])('parses %j', (text, value) => {
    expect(parseNumber(text)).toEqual({ ok: true, value })
  })

  it('turns -0 into 0', () => {
    const result = parseNumber('-0')
    expect(result.ok && Object.is(result.value, 0)).toBe(true)
  })

  it.each(['1e3', '+1', '1,5', '0x10', '.5', '5.', '٣', '1_000', ...HOSTILE])(
    'refuses %j',
    (text) => {
      expect(parseNumber(text).ok).toBe(false)
    },
  )

  it('formats and round trips', () => {
    expect(formatNumber(1.618)).toBe('1.618')
    expect(parseNumber(formatNumber(-0.25))).toEqual({ ok: true, value: -0.25 })
  })
})

describe('alias', () => {
  it.each([
    ['{primitive.color.blue-500}', 'primitive.color.blue-500'],
    ['primitive.color.blue-500', 'primitive.color.blue-500'],
    ['  {semantic.a}  ', 'semantic.a'],
    ['a', 'a'],
  ])('parses %j', (text, value) => {
    expect(parseAliasText(text)).toEqual({ ok: true, value })
  })

  it.each([
    '{}',
    '{ }',
    '{a.B}',
    '{a..b}',
    '{{a}}',
    '{a',
    'a}',
    'a b',
    'a.b.',
    '.a',
    `{${'a'.repeat(250)}}`,
    ...COMMON,
    ...NAMEY,
    'NaN',
    'Infinity',
  ])('refuses %j', (text) => {
    expect(parseAliasText(text).ok).toBe(false)
  })

  it('formats with braces', () => {
    expect(formatAlias('a.b')).toBe('{a.b}')
  })
})
