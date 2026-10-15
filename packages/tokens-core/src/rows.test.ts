import { describe, expect, it } from 'vitest'
import { tokenFromParts, tokenToParts, type TokenParts } from './rows'
import type { Token } from './types'

// Shared by the API (stored rows) and the web editor (API responses): PURE and
// DEFENSIVE. Parts that cannot be turned into a Token yield a message, never a throw.
// (Moved from apps/api/test/tokens/mapper.test.ts; that file still runs against the
// API wrapper unchanged.)

const COLOR = { colorSpace: 'srgb', components: [0.1, 0.2, 0.3] } as const

const TOKENS: [string, Token][] = [
  [
    'color',
    {
      path: 'primitive.color.blue',
      type: 'color',
      value: {
        ...COLOR,
        components: [0.1, 0.2, 0.3],
        alpha: 0.5,
        hex: '#1a334d',
      },
    },
  ],
  [
    'dimension',
    {
      path: 'primitive.space.4',
      type: 'dimension',
      value: { value: 16, unit: 'px' },
      description: 'four',
    },
  ],
  [
    'fontFamily (string)',
    { path: 'primitive.font.sans', type: 'fontFamily', value: 'Inter' },
  ],
  [
    'fontFamily (list)',
    {
      path: 'primitive.font.stack',
      type: 'fontFamily',
      value: ['Inter', 'sans-serif'],
    },
  ],
  [
    'fontWeight (number)',
    { path: 'primitive.weight.bold', type: 'fontWeight', value: 700 },
  ],
  [
    'fontWeight (name)',
    { path: 'primitive.weight.named', type: 'fontWeight', value: 'bold' },
  ],
  ['number', { path: 'primitive.ratio.golden', type: 'number', value: 1.618 }],
  [
    'alias without a type',
    { path: 'semantic.color.action', alias: 'primitive.color.blue' },
  ],
  [
    'alias with a declared type',
    {
      path: 'semantic.color.action2',
      alias: 'primitive.color.blue',
      type: 'color',
      description: 'declared',
    },
  ],
]

describe('tokenToParts / tokenFromParts round trip', () => {
  it.each(TOKENS)('%s survives a round trip', (_label, token) => {
    const row = tokenToParts(token)
    const back = tokenFromParts({
      ...row,
      description: row.description ?? null,
    })
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.token).toEqual(token)
  })

  it('an alias is stored as "{target}" with a NULL type unless one was declared', () => {
    expect(
      tokenToParts({ path: 'semantic.a', alias: 'primitive.b' }),
    ).toMatchObject({ type: null, value: '{primitive.b}' })
    expect(
      tokenToParts({ path: 'semantic.a', alias: 'primitive.b', type: 'color' }),
    ).toMatchObject({ type: 'color', value: '{primitive.b}' })
  })

  it('does not share objects with its input', () => {
    const token: Token = {
      path: 'primitive.color.x',
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 0] },
    }
    const row = tokenToParts(token)
    expect(row.value).not.toBe(token.type === 'color' ? token.value : null)
  })
})

describe('tokenFromParts is defensive: a bad stored row is an issue, never a throw', () => {
  const base = { path: 'primitive.color.x', description: null }
  const bad: [string, TokenParts][] = [
    ['unknown type', { ...base, type: 'gradient', value: 1 }],
    ['literal with a NULL type', { ...base, type: null, value: 5 }],
    ['color with a string value', { ...base, type: 'color', value: 'red' }],
    [
      'color with wrong arity',
      {
        ...base,
        type: 'color',
        value: { colorSpace: 'srgb', components: [1] },
      },
    ],
    ['color value null', { ...base, type: 'color', value: null }],
    [
      'dimension with a bad unit',
      { ...base, type: 'dimension', value: { value: 1, unit: 'em' } },
    ],
    [
      'dimension with a string value',
      { ...base, type: 'dimension', value: '16px' },
    ],
    ['fontFamily empty list', { ...base, type: 'fontFamily', value: [] }],
    ['fontWeight 0', { ...base, type: 'fontWeight', value: 0 }],
    ['number as a string', { ...base, type: 'number', value: '1' }],
    ['number null', { ...base, type: 'number', value: null }],
    [
      'alias with an invalid target',
      { ...base, type: null, value: '{Bad.Target}' },
    ],
    ['alias with nested braces', { ...base, type: null, value: '{a{b}}' }],
    [
      'alias with an unknown declared type',
      { ...base, type: 'nope', value: '{a.b\n}' },
    ],
    ['empty path', { ...base, path: '', type: 'number', value: 1 }],
    [
      'invalid path segment',
      { ...base, path: 'a..b', type: 'number', value: 1 },
    ],
    [
      'uppercase path',
      { ...base, path: 'Primitive.x', type: 'number', value: 1 },
    ],
    [
      'object where a string alias should be',
      { ...base, type: null, value: { alias: 'a.b' } },
    ],
    ['array value for number', { ...base, type: 'number', value: [1] }],
    ['undefined value', { ...base, type: 'number', value: undefined }],
  ]

  it.each(bad)('%s', (_label, row) => {
    const result = tokenFromParts(row)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it('a non-finite number can never have been stored (JSON has none) and is refused', () => {
    expect(
      tokenFromParts({
        ...base,
        type: 'number',
        value: Number.POSITIVE_INFINITY,
      }).ok,
    ).toBe(false)
  })

  it('a hostile object value does not throw', () => {
    const evil = JSON.parse(
      '{"__proto__":{"x":1},"colorSpace":"srgb"}',
    ) as unknown
    expect(() =>
      tokenFromParts({ ...base, type: 'color', value: evil }),
    ).not.toThrow()
  })

  it('a literal warning (HEX_MISMATCH) is kept as a warning, the token still maps', () => {
    const result = tokenFromParts({
      ...base,
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#ffffff' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings.map((w) => w.code)).toEqual(['HEX_MISMATCH'])
    }
  })
})

describe('tokenFromParts: more cases for the browser', () => {
  const base = { path: 'semantic.color.x', description: null }

  it('keeps a description on an alias and on a literal; ignores a non-string one', () => {
    const a = tokenFromParts({
      ...base,
      type: null,
      value: '{a.b}',
      description: 'why',
    })
    expect(a.ok && a.token.description).toBe('why')
    const b = tokenFromParts({
      path: 'primitive.x.y',
      type: 'number',
      value: 1,
      description: 5 as unknown as string,
    })
    expect(b.ok && b.token.description).toBeUndefined()
  })

  it('accepts a name that is also an Object.prototype property (valid segments, never used as object keys here)', () => {
    const result = tokenFromParts({
      path: 'primitive.constructor.valueof',
      type: 'number',
      value: 1,
    } as TokenParts)
    expect(result.ok).toBe(true)
  })

  it('refuses __proto__ and other invalid segments', () => {
    for (const path of [
      '__proto__',
      'primitive.__proto__.x',
      'a.b ',
      'a/b',
      ' ',
    ]) {
      expect(
        tokenFromParts({ path, type: 'number', value: 1, description: null })
          .ok,
        path,
      ).toBe(false)
    }
  })

  it('refuses a non-string path without throwing', () => {
    expect(
      tokenFromParts({
        path: 5 as unknown as string,
        type: 'number',
        value: 1,
        description: null,
      }).ok,
    ).toBe(false)
  })

  it('refuses a 10 KB string for a number; a 10 KB alias is valid syntax (length limits belong to the API) and does not throw', () => {
    expect(
      tokenFromParts({ ...base, type: 'number', value: 'x'.repeat(10_000) }).ok,
    ).toBe(false)
    expect(() =>
      tokenFromParts({
        ...base,
        type: null,
        value: `{${'a'.repeat(10_000)}}`,
      }),
    ).not.toThrow()
  })

  it('refuses control characters in an alias target', () => {
    expect(tokenFromParts({ ...base, type: null, value: '{a.b\n}' }).ok).toBe(
      false,
    )
  })

  it('refuses a self-reference-looking value that is not a string alias', () => {
    expect(tokenFromParts({ ...base, type: null, value: '{}' }).ok).toBe(false)
    expect(tokenFromParts({ ...base, type: null, value: '{ }' }).ok).toBe(false)
  })

  it('does not mutate its input', () => {
    const value = { colorSpace: 'srgb', components: [0.1, 0.2, 0.3] }
    const frozen = JSON.parse(JSON.stringify(value)) as unknown
    tokenFromParts({
      path: 'primitive.c.x',
      type: 'color',
      value,
      description: null,
    })
    expect(value).toEqual(frozen)
  })
})
