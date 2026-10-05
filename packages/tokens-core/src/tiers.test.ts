import { describe, expect, it } from 'vitest'
import { checkTiers } from './tiers'
import { alias, codes, color, num } from './testHelpers'

describe('checkTiers: allowed shapes', () => {
  it('accepts literals in every tier', () => {
    expect(
      checkTiers([
        color('primitive.color.blue'),
        num('semantic.opacity'),
        num('component.button.count'),
      ]),
    ).toEqual([])
  })

  it('accepts semantic -> primitive and semantic -> semantic', () => {
    expect(
      checkTiers([
        alias('semantic.action', 'primitive.color.blue'),
        alias('semantic.link', 'semantic.action'),
      ]),
    ).toEqual([])
  })

  it('accepts component -> semantic and component -> component', () => {
    expect(
      checkTiers([
        alias('component.button.bg', 'semantic.action'),
        alias('component.link.bg', 'component.button.bg'),
      ]),
    ).toEqual([])
  })
})

describe('checkTiers: violations', () => {
  it('forbids a primitive token from being an alias', () => {
    const issues = checkTiers([alias('primitive.a', 'primitive.b')])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'TIER_VIOLATION',
        severity: 'error',
        path: 'primitive.a',
        field: '$value',
        related: ['primitive.b'],
      }),
    ])
  })

  it('forbids a component token from aliasing a primitive token', () => {
    const issues = checkTiers([
      alias('component.button.bg', 'primitive.color.blue'),
    ])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'TIER_VIOLATION',
        path: 'component.button.bg',
        field: '$value',
        related: ['primitive.color.blue'],
      }),
    ])
    expect(issues[0]?.message).toMatch(/primitive/)
  })

  it('forbids a semantic token from aliasing a component token', () => {
    expect(codes(checkTiers([alias('semantic.a', 'component.b.c')]))).toEqual([
      'TIER_VIOLATION',
    ])
  })

  it('reports tokens outside the three tier groups', () => {
    const issues = checkTiers([
      num('brand.logo'),
      num('primitive'),
      num('loose'),
    ])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['brand.logo', 'TIER_VIOLATION'],
      ['loose', 'TIER_VIOLATION'],
      ['primitive', 'TIER_VIOLATION'],
    ])
  })

  it('does not double-report when the alias target has an unknown tier', () => {
    expect(checkTiers([alias('semantic.a', 'brand.x')])).toEqual([])
  })

  it('checks direct alias edges only and does not need the target to exist', () => {
    expect(checkTiers([alias('semantic.a', 'primitive.missing')])).toEqual([])
  })

  it('returns issues sorted by path', () => {
    const issues = checkTiers([
      alias('primitive.z', 'primitive.a'),
      alias('primitive.b', 'primitive.a'),
    ])
    expect(issues.map((issue) => issue.path)).toEqual([
      'primitive.b',
      'primitive.z',
    ])
  })
})
