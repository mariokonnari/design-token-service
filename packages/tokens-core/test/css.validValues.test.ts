import { describe, expect, it } from 'vitest'
import { toCssVariables } from '../src/css'
import {
  color,
  colorA,
  dim,
  fontFamily,
  fontWeight,
  num,
} from '../src/testHelpers'
import type { ResolvedToken } from '../src/types'
import {
  expectCleanExport,
  matchesGrammar,
  tokenKinds,
} from './support/cssOracle'

/** The value of the only declaration the exporter writes for one token. */
function exported(token: ResolvedToken): string {
  const { css, issues } = toCssVariables([token])
  expect(issues).toEqual([])
  expectCleanExport(css, { selector: ':root', names: ['--a'] })
  const match = /^ {2}--a: (.*);$/m.exec(css)
  if (match?.[1] === undefined) throw new Error(`no declaration in ${css}`)
  return match[1]
}

describe('extreme numbers are valid CSS numbers', () => {
  // [input, exact exporter output for the number, exact output for a px dimension]
  const cases: [number, string][] = [
    [1e-7, '1e-7'],
    [1e21, '1e+21'],
    [-1.5, '-1.5'],
    [-0, '0'],
    [0, '0'],
    [5e-324, '5e-324'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
    [0.1 + 0.2, '0.30000000000000004'],
    [123456789.12345679, '123456789.12345679'],
  ]

  it.each(cases)('number token %d is written as %s', (input, text) => {
    const value = exported(num('a', input))
    expect(value).toBe(text)
    // One Number token and nothing else: a valid CSS <number>.
    expect(tokenKinds(value)).toEqual([['Number', text]])
  })

  it.each(cases)('dimension %d px is written as %spx', (input, text) => {
    const value = exported(dim('a', input, 'px'))
    expect(value).toBe(`${text}px`)
    // One Dimension token: a valid CSS <length> (margin-left allows negatives).
    expect(tokenKinds(value)).toEqual([['Dimension', `${text}px`]])
    expect(matchesGrammar('margin-left', value)).toBe(true)
  })

  it('writes rem dimensions the same way', () => {
    expect(exported(dim('a', 1e-7, 'rem'))).toBe('1e-7rem')
    expect(tokenKinds('1e-7rem')).toEqual([['Dimension', '1e-7rem']])
  })
})

describe('every serialized value matches the grammar of a real CSS property', () => {
  it.each([
    ['opaque color', color('a', [0.145, 0.388, 0.922]), 'color'],
    ['translucent color', colorA('a', [1, 0, 0], 0.5), 'color'],
    ['fully transparent color', colorA('a', [1, 0, 0], 0), 'color'],
    ['dimension', dim('a', 0.5, 'rem'), 'margin-left'],
    ['numeric font weight', fontWeight('a', 350), 'font-weight'],
    ['named font weight', fontWeight('a', 'extra-black'), 'font-weight'],
    ['top font weight', fontWeight('a', 1000), 'font-weight'],
    [
      'a web font stack',
      fontFamily('a', [
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'sans-serif',
      ]),
      'font-family',
    ],
    [
      'a hostile name',
      fontFamily('a', 'Arial"; } x { y: z } /*'),
      'font-family',
    ],
  ] as const)('%s', (_label, token, property) => {
    expect(matchesGrammar(property, exported(token))).toBe(true)
  })

  it('the grammar check can fail (control case)', () => {
    expect(matchesGrammar('color', 'not-a-color')).toBe(false)
    expect(matchesGrammar('font-weight', '1001')).toBe(false)
  })
})
