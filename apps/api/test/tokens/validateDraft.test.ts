import { describe, expect, it } from 'vitest'
import type { TokenRowInput } from '../../src/tokens/mapper'
import {
  DEFAULT_RULES,
  validateDraft,
  type Rule,
} from '../../src/tokens/validateDraft'

// Pure: rows in, { issues, publishable } out. The pipeline is
// mapper -> resolve -> rules (tiers, CSS names, and any rule a caller adds).

const COLOR = { colorSpace: 'srgb', components: [0, 0, 0] }
let n = 0
const row = (
  path: string,
  type: string | null,
  value: unknown,
  description: string | null = null,
): TokenRowInput => ({ path, type, value, description, version: ++n })

const blue = row('primitive.color.blue', 'color', COLOR)
const action = row('semantic.color.action', null, '{primitive.color.blue}')
const button = row(
  'component.button.background',
  null,
  '{semantic.color.action}',
)

const codes = (rows: TokenRowInput[]) =>
  validateDraft(rows).issues.map((i) => `${i.code}@${i.path}`)

describe('validateDraft: what is publishable', () => {
  it('a valid three-tier draft has no issues and is publishable', () => {
    expect(validateDraft([blue, action, button])).toEqual({
      issues: [],
      publishable: true,
    })
  })

  it('an EMPTY draft is NOT publishable, and says why', () => {
    const result = validateDraft([])
    expect(result.publishable).toBe(false)
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'EMPTY_DRAFT',
        severity: 'error',
        path: '',
      }),
    ])
  })

  it('warnings alone do not block publishing', () => {
    // (a semantic alias is included: a primitives-only draft exports nothing, ADR 0015)
    const result = validateDraft([
      row('primitive.color.x', 'color', { ...COLOR, hex: '#ffffff' }),
      row('semantic.color.x', null, '{primitive.color.x}'),
    ])
    expect(result.issues.map((i) => i.code)).toEqual(['HEX_MISMATCH'])
    expect(result.issues[0]?.severity).toBe('warning')
    expect(result.publishable).toBe(true)
  })
})

describe('validateDraft: problems tokens-core finds', () => {
  it('an alias to a missing token is ALIAS_NOT_FOUND', () => {
    const result = validateDraft([action])
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(['ALIAS_NOT_FOUND'])
    expect(result.issues[0]?.path).toBe('semantic.color.action')
  })

  it('an alias cycle is ALIAS_CYCLE for every member', () => {
    const result = validateDraft([
      row('semantic.a', null, '{semantic.b}'),
      row('semantic.b', null, '{semantic.a}'),
    ])
    expect(result.publishable).toBe(false)
    expect(result.issues.filter((i) => i.code === 'ALIAS_CYCLE')).toHaveLength(
      2,
    )
  })

  it('a self-alias is a cycle too', () => {
    expect(codes([row('semantic.a', null, '{semantic.a}')])).toContain(
      'ALIAS_CYCLE@semantic.a',
    )
  })

  it('a tier violation: a primitive that is an alias, a component aliasing a primitive, a token outside the tiers', () => {
    const result = validateDraft([
      blue,
      row('primitive.color.alias', null, '{primitive.color.blue}'),
      row('component.button.border', null, '{primitive.color.blue}'),
      row('loose', 'number', 1),
    ])
    expect(result.publishable).toBe(false)
    const tier = result.issues
      .filter((i) => i.code === 'TIER_VIOLATION')
      .map((i) => i.path)
    expect(tier.sort()).toEqual(
      ['component.button.border', 'loose', 'primitive.color.alias'].sort(),
    )
  })

  it('a declared type that disagrees with the target is TYPE_MISMATCH', () => {
    const result = validateDraft([
      blue,
      row('semantic.color.wrong', 'number', '{primitive.color.blue}'),
    ])
    expect(result.issues.map((i) => i.code)).toContain('TYPE_MISMATCH')
    expect(result.publishable).toBe(false)
  })

  it('two paths that map to the same CSS variable are CSS_NAME_COLLISION (and nothing is silently dropped)', () => {
    const result = validateDraft([
      row('primitive.a.b-c', 'number', 1),
      row('primitive.a-b.c', 'number', 2),
      row('semantic.n.x', 'number', 3), // keeps the draft exportable
    ])
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual([
      'CSS_NAME_COLLISION',
      'CSS_NAME_COLLISION',
    ])
  })
})

describe('validateDraft: a corrupt stored row', () => {
  const broken = row('primitive.color.broken', 'color', 'not a colour')

  it('is reported as UNMAPPABLE_ROW and blocks publishing; the rest is still checked', () => {
    const result = validateDraft([blue, action, broken])
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => `${i.code}@${i.path}`)).toEqual([
      'UNMAPPABLE_ROW@primitive.color.broken',
    ])
  })

  it('an alias to an unmappable row is ALIAS_TARGET_INVALID (not "missing")', () => {
    const result = validateDraft([
      broken,
      row('semantic.color.x', null, '{primitive.color.broken}'),
    ])
    expect(result.issues.map((i) => i.code).sort()).toEqual([
      'ALIAS_TARGET_INVALID',
      'UNMAPPABLE_ROW',
    ])
  })

  it('a draft of ONLY unmappable rows is not empty, and not publishable', () => {
    const result = validateDraft([broken])
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(['UNMAPPABLE_ROW'])
  })

  it('never throws on hostile rows', () => {
    expect(() =>
      validateDraft([
        row('', null, null),
        row('A..B', 'nope', { __proto__: 1 }),
        { path: 'x', type: null, value: undefined, description: null },
      ]),
    ).not.toThrow()
  })
})

describe('validateDraft: ordering and extension', () => {
  it('issues are sorted by path (comparePaths), independent of row order', () => {
    const rows = [
      row('semantic.b', null, '{semantic.missing}'),
      row('semantic.a', null, '{semantic.missing}'),
      row('semantic.c', null, '{semantic.missing}'),
    ]
    const forward = validateDraft(rows).issues.map((i) => i.path)
    const reverse = validateDraft([...rows].reverse()).issues.map((i) => i.path)
    expect(forward).toEqual(['semantic.a', 'semantic.b', 'semantic.c'])
    expect(reverse).toEqual(forward)
  })

  it('DEFAULT_RULES are the tier, CSS-name, nothing-to-export and release-size rules; a caller can ADD a rule without changing validateDraft', () => {
    expect(DEFAULT_RULES).toHaveLength(4)
    const seen: number[] = []
    const noPureBlack: Rule = ({ resolved }) => {
      seen.push(resolved.length)
      return resolved
        .filter((t) => t.type === 'color')
        .map((t) => ({
          code: 'INVALID_VALUE' as const,
          severity: 'error' as const,
          path: t.path,
          message: 'Contrast gate (stand-in for the Phase 5 rule)',
        }))
    }
    const rows = [blue, action, button]
    const base = validateDraft(rows)
    const extended = validateDraft(rows, [...DEFAULT_RULES, noPureBlack])
    expect(base.publishable).toBe(true)
    expect(extended.publishable).toBe(false)
    // the rule saw the RESOLVED tokens (3 here: the aliases resolved to blue)
    expect(seen).toEqual([3])
    expect(extended.issues.map((i) => i.path)).toEqual([
      'component.button.background',
      'primitive.color.blue',
      'semantic.color.action',
    ])
  })

  it('a rule that throws does not take validation down: it becomes an error issue', () => {
    const exploding: Rule = () => {
      throw new Error('boom')
    }
    const result = validateDraft([blue, action], [...DEFAULT_RULES, exploding])
    expect(result.publishable).toBe(false)
    expect(result.issues.map((i) => i.code)).toEqual(['RULE_FAILED'])
  })
})
