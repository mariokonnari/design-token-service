import { describe, expect, it } from 'vitest'
import {
  comparePaths,
  isValidName,
  joinPath,
  parseAlias,
  splitPath,
} from './names'

describe('isValidName', () => {
  it.each(['a', 'blue', '500', 'blue-500', 'a-b-c1', '0'])(
    'accepts %j',
    (name) => {
      expect(isValidName(name)).toBe(true)
    },
  )

  it.each([
    '',
    'Blue',
    'a_b',
    '-a',
    'a-',
    'a--b',
    'a.b',
    '$root',
    'a b',
    'é',
    '{a}',
    '__proto__',
  ])('rejects %j', (name) => {
    expect(isValidName(name)).toBe(false)
  })
})

describe('splitPath / joinPath', () => {
  it('round-trips a dotted path', () => {
    expect(splitPath('color.blue.500')).toEqual(['color', 'blue', '500'])
    expect(joinPath(['color', 'blue', '500'])).toBe('color.blue.500')
  })

  it('treats the empty string as the root (no segments)', () => {
    expect(splitPath('')).toEqual([])
    expect(joinPath([])).toBe('')
  })
})

describe('comparePaths', () => {
  const sorted = (paths: string[]) => [...paths].sort(comparePaths)

  it('orders numeric segments numerically, before other segments', () => {
    expect(
      sorted([
        'color.blue.1000',
        'color.blue.500',
        'color.blue.50a',
        'color.blue.100',
        'color.alpha',
      ]),
    ).toEqual([
      'color.alpha',
      'color.blue.100',
      'color.blue.500',
      'color.blue.1000',
      'color.blue.50a',
    ])
  })

  it('treats segments with leading zeros as plain strings', () => {
    expect(sorted(['x.007', 'x.7', 'x.10'])).toEqual(['x.7', 'x.10', 'x.007'])
  })

  it('orders a prefix before its extensions', () => {
    expect(comparePaths('a', 'a.b')).toBeLessThan(0)
    expect(comparePaths('a.b', 'a')).toBeGreaterThan(0)
  })

  it('returns 0 for equal paths and is antisymmetric', () => {
    expect(comparePaths('a.b', 'a.b')).toBe(0)
    expect(Math.sign(comparePaths('a', 'b'))).toBe(
      -Math.sign(comparePaths('b', 'a')),
    )
  })

  it('matches the iteration order of JS object keys', () => {
    const paths = ['k.10', 'k.2', 'k.b', 'k.a', 'k.007']
    const obj: Record<string, number> = {}
    for (const path of sorted(paths)) obj[splitPath(path)[1] ?? ''] = 1
    expect(Object.keys(obj)).toEqual(
      sorted(paths).map((path) => splitPath(path)[1]),
    )
  })
})

describe('parseAlias', () => {
  it('parses a reference to a token path', () => {
    expect(parseAlias('{color.blue.500}')).toEqual({
      kind: 'alias',
      target: 'color.blue.500',
    })
  })

  it.each(['red', '', '{a', 'a}', 'x{a}', '{a}x', ' {a}'])(
    'does not treat %j as an alias',
    (raw) => {
      expect(parseAlias(raw).kind).toBe('not-alias')
    },
  )

  it.each([
    '{}',
    '{a..b}',
    '{A.b}',
    '{a b}',
    '{{a}}',
    '{a.}',
    '{.a}',
    '{a.$b}',
  ])('reports %j as a malformed alias', (raw) => {
    expect(parseAlias(raw).kind).toBe('malformed')
  })
})
