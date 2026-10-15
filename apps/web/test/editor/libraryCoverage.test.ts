import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { libraryCoverage } from '../../src/editor/libraryCoverage'
import { STARTER_TOKENS } from '../../src/editor/starter'

const num = (path: string): Token => ({ path, type: 'number', value: 1 })

describe('libraryCoverage: which library tokens does a draft define?', () => {
  const starter: Token[] = [
    num('primitive.a'),
    num('semantic.x'),
    num('semantic.y'),
    num('component.button.bg'),
  ]

  it('counts the starter semantic and component paths only (primitives are not library tokens)', () => {
    const result = libraryCoverage([], starter)
    expect(result.total).toBe(3)
    expect(result.defined).toBe(0)
    expect(result.missing).toEqual([
      'component.button.bg',
      'semantic.x',
      'semantic.y',
    ])
  })

  it('is a set difference: extra tokens and primitives do not count', () => {
    const result = libraryCoverage(
      [num('semantic.x'), num('primitive.a'), num('semantic.not-in-starter')],
      starter,
    )
    expect(result).toEqual({
      defined: 1,
      total: 3,
      missing: ['component.button.bg', 'semantic.y'],
    })
  })

  it('does not double count a duplicate path', () => {
    const result = libraryCoverage(
      [num('semantic.x'), num('semantic.x')],
      starter,
    )
    expect(result.defined).toBe(1)
  })

  it('is complete when every library path is defined, aliases and literals alike', () => {
    const result = libraryCoverage(
      [
        num('semantic.x'),
        { path: 'semantic.y', alias: 'primitive.a' },
        num('component.button.bg'),
      ],
      starter,
    )
    expect(result).toEqual({ defined: 3, total: 3, missing: [] })
  })

  it('lists missing paths in token order (numeric segments numerically)', () => {
    const result = libraryCoverage(
      [],
      [num('semantic.s.10'), num('semantic.s.9'), num('semantic.a')],
    )
    expect(result.missing).toEqual([
      'semantic.a',
      'semantic.s.9',
      'semantic.s.10',
    ])
  })

  it('works with the real starter template: it covers itself, an empty draft covers nothing', () => {
    const full = libraryCoverage(STARTER_TOKENS, STARTER_TOKENS)
    expect(full.total).toBeGreaterThan(150)
    expect(full.defined).toBe(full.total)
    expect(full.missing).toEqual([])
    const none = libraryCoverage([], STARTER_TOKENS)
    expect(none.defined).toBe(0)
    expect(none.missing).toHaveLength(none.total)
  })
})
