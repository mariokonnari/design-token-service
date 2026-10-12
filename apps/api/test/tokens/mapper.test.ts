import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import {
  rowToToken,
  tokenToRow,
  type TokenRowInput,
} from '../../src/tokens/mapper'

// The mapper is PURE (no Prisma import) and DEFENSIVE: a stored row that cannot be
// turned into a tokens-core Token yields an issue, never a throw.

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

describe('tokenToRow / rowToToken round trip', () => {
  it.each(TOKENS)('%s survives a round trip', (_label, token) => {
    const row = tokenToRow(token)
    const back = rowToToken({
      ...row,
      description: row.description ?? null,
    })
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.token).toEqual(token)
  })

  it('an alias is stored as "{target}" with a NULL type unless one was declared', () => {
    expect(
      tokenToRow({ path: 'semantic.a', alias: 'primitive.b' }),
    ).toMatchObject({ type: null, value: '{primitive.b}' })
    expect(
      tokenToRow({ path: 'semantic.a', alias: 'primitive.b', type: 'color' }),
    ).toMatchObject({ type: 'color', value: '{primitive.b}' })
  })

  it('does not share objects with its input', () => {
    const token: Token = {
      path: 'primitive.color.x',
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 0] },
    }
    const row = tokenToRow(token)
    expect(row.value).not.toBe(token.type === 'color' ? token.value : null)
  })
})

describe('rowToToken is defensive: a bad stored row is an issue, never a throw', () => {
  const base = { path: 'primitive.color.x', description: null, version: 1 }
  const bad: [string, TokenRowInput][] = [
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
      { ...base, type: 'nope', value: '{a.b}' },
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
    const result = rowToToken(row)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issue.code).toBe('UNMAPPABLE_ROW')
      expect(result.issue.severity).toBe('error')
      expect(result.issue.path).toBe(row.path)
      expect(result.issue.message.length).toBeGreaterThan(0)
    }
  })

  it('a non-finite number can never have been stored (JSON has none) and is refused', () => {
    expect(
      rowToToken({ ...base, type: 'number', value: Number.POSITIVE_INFINITY })
        .ok,
    ).toBe(false)
  })

  it('a hostile object value does not throw', () => {
    const evil = JSON.parse(
      '{"__proto__":{"x":1},"colorSpace":"srgb"}',
    ) as unknown
    expect(() =>
      rowToToken({ ...base, type: 'color', value: evil }),
    ).not.toThrow()
  })

  it('a literal warning (HEX_MISMATCH) is kept as a warning, the token still maps', () => {
    const result = rowToToken({
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
