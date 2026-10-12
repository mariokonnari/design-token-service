import { describe, expect, it } from 'vitest'
import { TREE_LIMITS, guardTree } from '../../src/tokens/treeGuard'

// An ITERATIVE walk over an untrusted tree, run BEFORE tokens-core's flatten.
// Why: flatten does not overflow the stack, but it is QUADRATIC in depth (it copies
// the path array at every level). Measured on this machine: 20,000 levels = 10.7 s
// and 50,000 levels = 68 s of synchronous CPU, from a 300 KB body.

function deep(levels: number): unknown {
  let node: unknown = { $type: 'number', $value: 1 }
  for (let i = 0; i < levels; i++) node = { a: node }
  return node
}

describe('guardTree: limits', () => {
  it('the limits are the documented ones', () => {
    expect(TREE_LIMITS).toEqual({ MAX_DEPTH: 32, MAX_NODES: 10_000 })
  })

  it('a normal tree passes', () => {
    expect(
      guardTree({
        primitive: { color: { blue: { $type: 'number', $value: 1 } } },
      }),
    ).toEqual([])
  })

  it('depth: exactly 32 levels of objects pass, 33 fail', () => {
    // the root is level 1; deep(n) adds n group levels + 1 token level
    expect(guardTree(deep(30))).toEqual([]) // 1 root-level group chain: 31 + token = 32
    expect(guardTree(deep(31))).toEqual([])
    const over = guardTree(deep(32))
    expect(over).toHaveLength(1)
    expect(over[0]).toMatchObject({ severity: 'error', field: 'depth' })
  })

  it('50,000 levels are refused immediately, without overflowing the stack', () => {
    const tree = deep(50_000)
    const started = performance.now()
    const issues = guardTree(tree)
    expect(performance.now() - started).toBeLessThan(250)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.field).toBe('depth')
  })

  it('a deeply nested $value is refused too', () => {
    let value: unknown = 1
    for (let i = 0; i < 50_000; i++) value = { x: value }
    expect(guardTree({ a: { $type: 'number', $value: value } })).toHaveLength(1)
  })

  it('node count: 10,000 objects pass, 10,001 fail', () => {
    const groups = (n: number) => {
      const tree: Record<string, unknown> = {}
      for (let i = 0; i < n; i++) tree[`g${i}`] = {}
      return tree
    }
    expect(guardTree(groups(TREE_LIMITS.MAX_NODES - 1))).toEqual([]) // + the root = 10,000
    const over = guardTree(groups(TREE_LIMITS.MAX_NODES))
    expect(over).toHaveLength(1)
    expect(over[0]?.field).toBe('nodes')
  })

  it('arrays are leaves: a long fontFamily list does not count as nodes', () => {
    expect(
      guardTree({
        f: {
          $type: 'fontFamily',
          $value: Array.from({ length: 5000 }, () => 'x'),
        },
      }),
    ).toEqual([])
  })

  it('stops at the first limit (one issue, not thousands)', () => {
    const tree: Record<string, unknown> = {}
    for (let i = 0; i < 50_000; i++) tree[`g${i}`] = {}
    expect(guardTree(tree)).toHaveLength(1)
  })
})

describe('guardTree: reserved names', () => {
  const parse = (json: string) => JSON.parse(json) as unknown

  it.each(['__proto__', 'constructor', 'prototype'])(
    'a key named %s is refused at any depth, with its path',
    (key) => {
      const top = guardTree(parse(`{"${key}":{"$type":"number","$value":1}}`))
      expect(top).toHaveLength(1)
      expect(top[0]).toMatchObject({ severity: 'error', field: 'name' })
      const nested = guardTree(
        parse(`{"primitive":{"${key}":{"$type":"number","$value":1}}}`),
      )
      expect(nested).toHaveLength(1)
      expect(nested[0]?.path).toBe(`primitive.${key}`)
    },
  )

  it('a __proto__ key arriving via JSON.parse is an OWN property and is seen', () => {
    const tree = parse('{"__proto__":{"polluted":true}}') as Record<
      string,
      unknown
    >
    expect(Object.hasOwn(tree, '__proto__')).toBe(true)
    expect(guardTree(tree)).toHaveLength(1)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('reports every offending key up to a small cap', () => {
    const tree: Record<string, unknown> = {}
    for (let i = 0; i < 30; i++) tree[`ok${i}`] = {}
    const bad = parse('{"constructor":{},"prototype":{}}') as Record<
      string,
      unknown
    >
    expect(guardTree({ ...tree, ...bad }).length).toBe(2)
  })
})

describe('guardTree: non-trees', () => {
  it.each([[null], [1], ['text'], [[]], [undefined]])(
    'a non-object root (%j) is left to flatten to report',
    (value) => {
      expect(guardTree(value)).toEqual([])
    },
  )
})
