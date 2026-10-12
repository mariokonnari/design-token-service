import { describe, expect, it } from 'vitest'
import { LIMITS, validateSingleToken } from '../../src/tokens/validateWrite'

// Single-token write validation REUSES tokens-core (flatten of a one-token tree), so
// the rules live in one place. Only the LIMITS below are the API's own.

const COLOR = { colorSpace: 'srgb', components: [0, 0, 0] }

describe('validateSingleToken: valid tokens', () => {
  it('a typed literal', () => {
    const r = validateSingleToken({
      path: 'primitive.color.black',
      type: 'color',
      value: COLOR,
    })
    expect(r).toMatchObject({
      ok: true,
      token: { path: 'primitive.color.black', type: 'color', value: COLOR },
    })
  })

  it('an alias needs no type', () => {
    const r = validateSingleToken({
      path: 'semantic.color.action',
      value: '{primitive.color.black}',
    })
    expect(r).toMatchObject({
      ok: true,
      token: { path: 'semantic.color.action', alias: 'primitive.color.black' },
    })
  })

  it('an alias may declare a type, and a description is kept', () => {
    const r = validateSingleToken({
      path: 'semantic.color.action',
      type: 'color',
      value: '{primitive.color.black}',
      description: 'The action colour',
    })
    expect(r).toMatchObject({
      ok: true,
      token: { type: 'color', description: 'The action colour' },
    })
  })

  it('a single-segment path is fine here (tiers are a /validate matter, not a write rule)', () => {
    expect(
      validateSingleToken({ path: 'x', type: 'number', value: 1 }).ok,
    ).toBe(true)
  })

  it('warnings are returned and do not fail the write', () => {
    const r = validateSingleToken({
      path: 'primitive.color.x',
      type: 'color',
      value: { ...COLOR, hex: '#ffffff' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.map((w) => w.code)).toEqual(['HEX_MISMATCH'])
  })
})

describe('validateSingleToken: rejected, with issues', () => {
  const codes = (r: ReturnType<typeof validateSingleToken>) =>
    r.ok ? [] : r.issues.map((i) => i.code)

  it.each([
    ['empty path', { path: '', type: 'number', value: 1 }, 'INVALID_NAME'],
    [
      'empty segment',
      { path: 'a..b', type: 'number', value: 1 },
      'INVALID_NAME',
    ],
    ['uppercase', { path: 'A.b', type: 'number', value: 1 }, 'INVALID_NAME'],
    ['underscore', { path: 'a.b_c', type: 'number', value: 1 }, 'INVALID_NAME'],
    [
      '__proto__ segment',
      { path: '__proto__.x', type: 'number', value: 1 },
      'INVALID_NAME',
    ],
    ['trailing dot', { path: 'a.', type: 'number', value: 1 }, 'INVALID_NAME'],
    ['no type, literal value', { path: 'a.b', value: 1 }, 'MISSING_TYPE'],
    [
      'unknown type',
      { path: 'a.b', type: 'gradient', value: 1 },
      'UNSUPPORTED_TYPE',
    ],
    ['non-string type', { path: 'a.b', type: 5, value: 1 }, 'INVALID_TYPE'],
    [
      'bad value for type',
      { path: 'a.b', type: 'number', value: 'x' },
      'INVALID_VALUE',
    ],
    [
      'unsupported colour space',
      {
        path: 'a.b',
        type: 'color',
        value: { colorSpace: 'oklch', components: [0, 0, 0] },
      },
      'UNSUPPORTED_COLOR_SPACE',
    ],
    [
      'malformed alias',
      { path: 'a.b', value: '{Bad Target}' },
      'INVALID_VALUE',
    ],
    ['empty alias', { path: 'a.b', value: '{}' }, 'INVALID_VALUE'],
    ['missing value', { path: 'a.b', type: 'number' }, 'INVALID_VALUE'],
    [
      'null value',
      { path: 'a.b', type: 'number', value: null },
      'INVALID_VALUE',
    ],
    [
      'non-string description',
      { path: 'a.b', type: 'number', value: 1, description: 5 },
      'INVALID_STRUCTURE',
    ],
  ])('%s', (_label, input, code) => {
    const r = validateSingleToken(input as never)
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain(code)
    if (!r.ok) {
      for (const issue of r.issues) {
        expect(typeof issue.path).toBe('string')
        expect(typeof issue.message).toBe('string')
      }
    }
  })

  it('Infinity (what JSON.parse("1e999") produces) is rejected for number and dimension, never stored as null', () => {
    const infinity = JSON.parse('1e999') as number
    expect(infinity).toBe(Number.POSITIVE_INFINITY)
    expect(
      validateSingleToken({ path: 'a.n', type: 'number', value: infinity }).ok,
    ).toBe(false)
    expect(
      validateSingleToken({
        path: 'a.d',
        type: 'dimension',
        value: { value: infinity, unit: 'px' },
      }).ok,
    ).toBe(false)
    expect(
      validateSingleToken({
        path: 'a.c',
        type: 'color',
        value: { colorSpace: 'srgb', components: [infinity, 0, 0] },
      }).ok,
    ).toBe(false)
  })
})

describe('validateSingleToken: limits', () => {
  it('the limits are the documented ones', () => {
    expect(LIMITS).toEqual({
      MAX_PATH_LENGTH: 200,
      MAX_VALUE_BYTES: 8192,
      MAX_DESCRIPTION_LENGTH: 500,
      MAX_TOKENS_PER_BRAND: 2000,
    })
  })

  it('a path of exactly 200 characters is accepted, 201 is rejected', () => {
    // 20 segments of 9 letters + 19 dots = 199, plus one more letter = 200
    const ok = `${Array.from({ length: 20 }, () => 'abcdefghi').join('.')}x`
    expect(ok.length).toBe(200)
    expect(validateSingleToken({ path: ok, type: 'number', value: 1 }).ok).toBe(
      true,
    )
    const tooLong = `${ok}x`
    const r = validateSingleToken({ path: tooLong, type: 'number', value: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.field).toBe('path')
  })

  it('a description of exactly 500 characters is accepted, 501 is rejected', () => {
    const base = { path: 'a.b', type: 'number', value: 1 }
    expect(
      validateSingleToken({ ...base, description: 'x'.repeat(500) }).ok,
    ).toBe(true)
    const r = validateSingleToken({ ...base, description: 'x'.repeat(501) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.field).toBe('description')
  })

  it('a value of exactly 8192 bytes of JSON is accepted, 8193 is rejected', () => {
    // fontFamily list: ["xxxx...", ...] sized to hit the limit exactly.
    const sized = (bytes: number) => {
      // ["…"] costs 4 bytes of overhead around one string
      return { path: 'a.b', type: 'fontFamily', value: ['x'.repeat(bytes - 4)] }
    }
    const exact = sized(8192)
    expect(Buffer.byteLength(JSON.stringify(exact.value))).toBe(8192)
    expect(validateSingleToken(exact).ok).toBe(true)
    const over = sized(8193)
    expect(Buffer.byteLength(JSON.stringify(over.value))).toBe(8193)
    const r = validateSingleToken(over)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.field === 'value')).toBe(true)
  })

  it('the value limit counts BYTES, not characters', () => {
    // 3-byte characters: 2800 of them are 8400 bytes but only 2800 characters
    const r = validateSingleToken({
      path: 'a.b',
      type: 'fontFamily',
      value: ['€'.repeat(2800)],
    })
    expect(r.ok).toBe(false)
  })
})
