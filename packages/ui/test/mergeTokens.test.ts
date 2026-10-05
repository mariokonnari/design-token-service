import { describe, expect, it } from 'vitest'
import { mergeTokenTrees, MergeError } from '../scripts/lib/mergeTokens'

const num = (value: number) => ({ $type: 'number', $value: value })

describe('mergeTokenTrees (overlay semantics, see ADR 0008)', () => {
  it('replaces a token that exists in both', () => {
    const merged = mergeTokenTrees(
      { primitive: { a: num(1), b: num(2) } },
      { primitive: { a: num(9) } },
    )
    expect(merged).toEqual({ primitive: { a: num(9), b: num(2) } })
  })

  it('replaces the whole token node rather than merging its properties', () => {
    const merged = mergeTokenTrees(
      { t: { $type: 'number', $value: 1, $description: 'old' } },
      { t: { $type: 'number', $value: 2 } },
    )
    expect(merged).toEqual({ t: { $type: 'number', $value: 2 } })
  })

  it('adds tokens and groups that only the overlay has', () => {
    const merged = mergeTokenTrees(
      { primitive: { a: num(1) } },
      { primitive: { b: num(2) }, extra: { c: num(3) } },
    )
    expect(merged).toEqual({
      primitive: { a: num(1), b: num(2) },
      extra: { c: num(3) },
    })
  })

  it('merges groups recursively and keeps a repeated group $type', () => {
    const merged = mergeTokenTrees(
      { g: { $type: 'number', x: { $value: 1 }, n: { y: { $value: 2 } } } },
      { g: { $type: 'number', n: { y: { $value: 20 }, z: { $value: 30 } } } },
    )
    expect(merged).toEqual({
      g: {
        $type: 'number',
        x: { $value: 1 },
        n: { y: { $value: 20 }, z: { $value: 30 } },
      },
    })
  })

  it('does not mutate its inputs and shares no objects with them', () => {
    const base = { g: { a: num(1) } }
    const overlay = { g: { b: num(2) } }
    const baseCopy = JSON.stringify(base)
    const overlayCopy = JSON.stringify(overlay)
    const merged = mergeTokenTrees(base, overlay) as {
      g: { a: { $value: number } }
    }
    merged.g.a.$value = 99
    expect(JSON.stringify(base)).toBe(baseCopy)
    expect(JSON.stringify(overlay)).toBe(overlayCopy)
  })

  it('treats an empty overlay as the base', () => {
    expect(mergeTokenTrees({ a: num(1) }, {})).toEqual({ a: num(1) })
  })

  it.each([
    [
      'a token replaced by a group',
      { t: num(1) },
      { t: { inner: num(2) } },
      't',
    ],
    [
      'a group replaced by a token',
      { t: { inner: num(2) } },
      { t: num(1) },
      't',
    ],
    [
      'a group $type that changes',
      { g: { $type: 'number', a: { $value: 1 } } },
      { g: { $type: 'color' } },
      'g',
    ],
  ])('rejects %s with a readable path', (_label, base, overlay, path) => {
    expect(() => mergeTokenTrees(base, overlay)).toThrow(MergeError)
    try {
      mergeTokenTrees(base, overlay)
    } catch (error) {
      expect((error as MergeError).path).toBe(path)
      expect((error as MergeError).message).toContain(path)
    }
  })

  it.each([
    ['a non-object base', 5, {}],
    ['a non-object overlay', {}, 'x'],
    ['an array overlay', {}, []],
    ['null', null, {}],
  ])('rejects %s', (_label, base, overlay) => {
    expect(() => mergeTokenTrees(base, overlay)).toThrow(MergeError)
  })

  it('rejects a __proto__ key and does not pollute prototypes', () => {
    const hostile: unknown = JSON.parse(
      '{"__proto__": {"polluted": true}, "a": {"$value": 1}}',
    )
    expect(() => mergeTokenTrees({}, hostile)).toThrow(MergeError)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()

    const nested: unknown = JSON.parse(
      '{"g": {"__proto__": {"polluted": true}}}',
    )
    expect(() => mergeTokenTrees({ g: {} }, nested)).toThrow(MergeError)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
