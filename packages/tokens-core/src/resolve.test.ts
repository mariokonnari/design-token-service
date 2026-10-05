import { describe, expect, it } from 'vitest'
import { resolve } from './resolve'
import { flatten } from './tree'
import type { Issue, Token } from './types'
import { alias, codes, color, dim, num } from './testHelpers'

function paths(tokens: { path: string }[]): string[] {
  return tokens.map((token) => token.path)
}

function issueFor(issues: readonly Issue[], path: string): Issue {
  const issue = issues.find((candidate) => candidate.path === path)
  if (issue === undefined) throw new Error(`no issue for ${path}`)
  return issue
}

describe('resolve: literals and chains', () => {
  it('passes literals through without alias fields', () => {
    const { resolved, issues } = resolve([num('a', 3)])
    expect(issues).toEqual([])
    expect(resolved).toEqual([{ path: 'a', type: 'number', value: 3 }])
  })

  it('keeps token descriptions', () => {
    const { resolved } = resolve([{ ...num('a'), description: 'hello' }])
    expect(resolved[0]).toMatchObject({ description: 'hello' })
  })

  it('follows an alias chain down to the literal', () => {
    const { resolved, issues } = resolve([
      alias('c', 'b'),
      alias('b', 'a'),
      color('a', [0, 0, 1]),
    ])
    expect(issues).toEqual([])
    expect(resolved).toEqual([
      {
        path: 'a',
        type: 'color',
        value: { colorSpace: 'srgb', components: [0, 0, 1] },
      },
      {
        path: 'b',
        type: 'color',
        value: { colorSpace: 'srgb', components: [0, 0, 1] },
        aliasOf: 'a',
        resolvesTo: 'a',
      },
      {
        path: 'c',
        type: 'color',
        value: { colorSpace: 'srgb', components: [0, 0, 1] },
        aliasOf: 'b',
        resolvesTo: 'a',
      },
    ])
  })

  it('does not share value objects between an alias and its target', () => {
    const { resolved } = resolve([color('a', [0, 0, 0]), alias('b', 'a')])
    const [a, b] = resolved
    if (a?.type === 'color' && b?.type === 'color') {
      expect(a.value).not.toBe(b.value)
      expect(a.value.components).not.toBe(b.value.components)
    } else {
      throw new Error('expected two color tokens')
    }
  })

  it('inherits the target type when no type is declared', () => {
    const { resolved } = resolve([dim('d', 4, 'rem'), alias('x', 'd')])
    expect(resolved.find((token) => token.path === 'x')?.type).toBe('dimension')
  })

  it('accepts a declared type that matches the target', () => {
    const { resolved, issues } = resolve([num('n'), alias('x', 'n', 'number')])
    expect(issues).toEqual([])
    expect(paths(resolved)).toEqual(['n', 'x'])
  })

  it('reports TYPE_MISMATCH when the declared type differs from the target', () => {
    const { resolved, issues } = resolve([num('n'), alias('x', 'n', 'color')])
    expect(paths(resolved)).toEqual(['n'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'TYPE_MISMATCH',
        severity: 'error',
        path: 'x',
        field: '$type',
        related: ['n'],
      }),
    ])
  })

  it('handles diamond-shaped graphs without reporting a cycle', () => {
    // top1 and top2 both reach `base` through the shared `mid`.
    const { resolved, issues } = resolve([
      alias('top2', 'mid'),
      alias('top1', 'mid'),
      alias('mid', 'base'),
      alias('side', 'base'),
      num('base', 9),
    ])
    expect(issues).toEqual([])
    expect(paths(resolved)).toEqual(['base', 'mid', 'side', 'top1', 'top2'])
    expect(resolved.every((token) => token.value === 9)).toBe(true)
  })

  it('resolves a very long alias chain without overflowing the stack', () => {
    const length = 20_000
    const tokens: Token[] = [num('n0', 5)]
    for (let i = 1; i <= length; i++) tokens.push(alias(`n${i}`, `n${i - 1}`))
    const { resolved, issues } = resolve(tokens.reverse())
    expect(issues).toEqual([])
    expect(resolved).toHaveLength(length + 1)
    const last = resolved.find((token) => token.path === `n${length}`)
    expect(last).toMatchObject({
      value: 5,
      aliasOf: `n${length - 1}`,
      resolvesTo: 'n0',
    })
  })
})

describe('resolve: missing targets', () => {
  it('reports ALIAS_NOT_FOUND', () => {
    const { resolved, issues } = resolve([alias('a', 'nowhere')])
    expect(resolved).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'ALIAS_NOT_FOUND',
        severity: 'error',
        path: 'a',
        field: '$value',
        related: ['nowhere'],
      }),
    ])
  })

  it('reports ALIAS_NOT_FOUND, mentioning the group, when the target is a group', () => {
    const { issues } = resolve([num('g.x'), alias('a', 'g')])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'ALIAS_NOT_FOUND', path: 'a' })
    expect(issues[0]?.message).toMatch(/group/)
  })
})

describe('resolve: ALIAS_TARGET_INVALID', () => {
  it('uses ALIAS_TARGET_INVALID, not ALIAS_NOT_FOUND, for rejected targets', () => {
    const { resolved, issues } = resolve([alias('a', 'bad.token')], {
      rejected: ['bad.token'],
    })
    expect(resolved).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'ALIAS_TARGET_INVALID',
        severity: 'error',
        path: 'a',
        field: '$value',
        related: ['bad.token'],
      }),
    ])
    expect(issues[0]?.message).toContain('bad.token')
  })

  it('propagates through chains of aliases', () => {
    const { resolved, issues } = resolve(
      [alias('a', 'b'), alias('b', 'rejected')],
      { rejected: ['rejected'] },
    )
    expect(resolved).toEqual([])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['a', 'ALIAS_TARGET_INVALID'],
      ['b', 'ALIAS_TARGET_INVALID'],
    ])
    expect(issueFor(issues, 'a').related).toEqual(['b'])
  })

  it('is used for dependents of a token that failed to resolve', () => {
    const { resolved, issues } = resolve([
      num('n'),
      alias('mismatch', 'n', 'color'),
      alias('dependent', 'mismatch'),
    ])
    expect(paths(resolved)).toEqual(['n'])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['dependent', 'ALIAS_TARGET_INVALID'],
      ['mismatch', 'TYPE_MISMATCH'],
    ])
  })

  it('prefers a real token over a rejected entry with the same path', () => {
    const { resolved, issues } = resolve([num('a'), alias('b', 'a')], {
      rejected: ['a'],
    })
    expect(issues).toEqual([])
    expect(paths(resolved)).toEqual(['a', 'b'])
  })

  it('still reports ALIAS_NOT_FOUND for paths that are not in rejected', () => {
    const { issues } = resolve([alias('a', 'other')], {
      rejected: ['elsewhere'],
    })
    expect(codes(issues)).toEqual(['ALIAS_NOT_FOUND'])
  })

  it('works end to end with flatten()', () => {
    const flat = flatten({
      base: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [9, 0, 0] },
      },
      link: { $value: '{base}' },
    })
    expect(codes(flat.issues)).toEqual(['INVALID_VALUE'])
    const { resolved, issues } = resolve(flat.tokens, {
      rejected: flat.rejected,
    })
    expect(resolved).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'ALIAS_TARGET_INVALID',
        path: 'link',
        related: ['base'],
      }),
    ])
  })
})

describe('resolve: cycles', () => {
  it('reports a self-reference as a cycle of length one', () => {
    const { resolved, issues } = resolve([alias('a', 'a')])
    expect(resolved).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'ALIAS_CYCLE',
        severity: 'error',
        path: 'a',
        related: ['a'],
      }),
    ])
    expect(issues[0]?.message).toContain('a -> a')
  })

  it('reports a two-node cycle for both members, with the full path', () => {
    const { resolved, issues } = resolve([alias('a', 'b'), alias('b', 'a')])
    expect(resolved).toEqual([])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['a', 'ALIAS_CYCLE'],
      ['b', 'ALIAS_CYCLE'],
    ])
    expect(issueFor(issues, 'a').message).toContain('a -> b -> a')
    expect(issueFor(issues, 'b').message).toContain('b -> a -> b')
    expect(issueFor(issues, 'a').related).toEqual(['a', 'b'])
  })

  it('reports a three-node cycle for every member regardless of input order', () => {
    const tokens = [alias('c', 'a'), alias('a', 'b'), alias('b', 'c')]
    const forward = resolve(tokens)
    const reversed = resolve([...tokens].reverse())
    expect(forward).toEqual(reversed)
    expect(forward.resolved).toEqual([])
    expect(forward.issues.map((issue) => issue.path)).toEqual(['a', 'b', 'c'])
    expect(issueFor(forward.issues, 'a').message).toContain('a -> b -> c -> a')
    expect(issueFor(forward.issues, 'c').message).toContain('c -> a -> b -> c')
    for (const issue of forward.issues) {
      expect(issue.code).toBe('ALIAS_CYCLE')
      expect(issue.related).toEqual(['a', 'b', 'c'])
    }
  })

  it('reports tokens that depend on a cycle, directly or transitively', () => {
    const { resolved, issues } = resolve([
      alias('a', 'b'),
      alias('b', 'a'),
      alias('d', 'a'),
      alias('e', 'd'),
      num('ok'),
    ])
    expect(paths(resolved)).toEqual(['ok'])
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['a', 'ALIAS_CYCLE'],
      ['b', 'ALIAS_CYCLE'],
      ['d', 'ALIAS_CYCLE'],
      ['e', 'ALIAS_CYCLE'],
    ])
    expect(issueFor(issues, 'd').message).toContain('a -> b -> a')
    expect(issueFor(issues, 'e').message).toContain('a -> b -> a')
    expect(issueFor(issues, 'e').related).toEqual(['a', 'b'])
  })

  it('does not confuse a cycle with a diamond that merely shares a node', () => {
    const { resolved, issues } = resolve([
      alias('x', 'shared'),
      alias('y', 'shared'),
      alias('shared', 'leaf'),
      alias('z', 'x'),
      num('leaf'),
    ])
    expect(issues).toEqual([])
    expect(resolved).toHaveLength(5)
  })

  it('stays linear and keeps a bounded message for a huge cycle', () => {
    const length = 5_000
    const tokens: Token[] = []
    for (let i = 0; i < length; i++) {
      tokens.push(alias(`n${i}`, `n${(i + 1) % length}`))
    }
    const { resolved, issues } = resolve(tokens)
    expect(resolved).toEqual([])
    expect(issues).toHaveLength(length)
    expect(issues.every((issue) => issue.code === 'ALIAS_CYCLE')).toBe(true)
    expect(issues[0]?.message.length).toBeLessThan(500)
  })
})

describe('resolve: robustness', () => {
  it('is deterministic regardless of input order', () => {
    const tokens: Token[] = [
      alias('z', 'missing'),
      num('n'),
      alias('m', 'n', 'color'),
      alias('a', 'b'),
      alias('b', 'a'),
      color('c'),
      alias('k', 'c'),
    ]
    expect(resolve([...tokens].reverse())).toEqual(resolve(tokens))
  })

  it('sorts resolved tokens and issues by path', () => {
    const { resolved, issues } = resolve([
      num('b.x'),
      num('a'),
      num('b.10'),
      num('b.2'),
      alias('y', 'nope'),
      alias('x', 'nope'),
    ])
    expect(paths(resolved)).toEqual(['a', 'b.2', 'b.10', 'b.x'])
    expect(paths(issues)).toEqual(['x', 'y'])
  })

  it('reports a duplicate path as PATH_CONFLICT and keeps the first token', () => {
    const { resolved, issues } = resolve([num('a', 1), num('a', 2)])
    expect(resolved).toEqual([{ path: 'a', type: 'number', value: 1 }])
    expect(issues).toEqual([
      expect.objectContaining({ code: 'PATH_CONFLICT', path: 'a' }),
    ])
  })

  it('does not mutate its input', () => {
    const tokens: Token[] = [alias('a', 'b'), color('b', [1, 0, 0])]
    const snapshot = JSON.stringify(tokens)
    resolve(tokens)
    expect(JSON.stringify(tokens)).toBe(snapshot)
  })

  it('handles paths that collide with Object.prototype members', () => {
    const { resolved, issues } = resolve([
      num('constructor', 1),
      alias('x', 'constructor'),
      alias('y', 'valueof'),
    ])
    expect(paths(resolved)).toEqual(['constructor', 'x'])
    expect(codes(issues)).toEqual(['ALIAS_NOT_FOUND'])
  })
})
