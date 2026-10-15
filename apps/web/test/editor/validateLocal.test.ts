import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { LIMITS } from '../../src/editor/limits'
import { validateLocal } from '../../src/editor/validateLocal'

// Local checks on the working copy, for instant feedback. They are NOT the
// publish gate: the result type has no "publishable" field, and only the
// server's /validate says that.

const num = (path: string, value = 1): Token => ({
  path,
  type: 'number',
  value,
})
const alias = (path: string, target: string): Token => ({
  path,
  alias: target,
})

const base: Token[] = [
  num('primitive.n.one'),
  alias('semantic.n.a', 'primitive.n.one'),
]

describe('validateLocal', () => {
  it('has nothing to say about a valid alias and a valid literal', () => {
    expect(
      validateLocal(alias('semantic.n.b', 'primitive.n.one'), base, true),
    ).toEqual([])
    expect(validateLocal(num('semantic.n.c'), base, true)).toEqual([])
  })

  it('never reports "publishable" (only the server can)', () => {
    const problems = validateLocal(num('semantic.n.c'), base, true)
    expect(JSON.stringify(problems)).not.toMatch(/publishable/i)
  })

  it('an alias to a missing token is an alias problem', () => {
    const problems = validateLocal(
      alias('semantic.n.b', 'primitive.nope'),
      base,
      true,
    )
    expect(problems.map((p) => p.field)).toContain('alias')
    expect(problems.find((p) => p.field === 'alias')?.message).toMatch(
      /no token|not found|exist/i,
    )
  })

  it('an alias that closes a cycle is reported', () => {
    const tokens = [alias('semantic.n.x', 'semantic.n.y')]
    const problems = validateLocal(
      alias('semantic.n.y', 'semantic.n.x'),
      tokens,
      true,
    )
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((p) => /cycle|itself|back/i.test(p.message))).toBe(
      true,
    )
  })

  it('an alias to itself is reported', () => {
    const problems = validateLocal(
      alias('semantic.n.s', 'semantic.n.s'),
      base,
      true,
    )
    expect(problems.length).toBeGreaterThan(0)
  })

  it('a primitive that is an alias breaks the tier rules', () => {
    const problems = validateLocal(
      alias('primitive.n.two', 'primitive.n.one'),
      base,
      true,
    )
    expect(problems.length).toBeGreaterThan(0)
  })

  it('a component token aliasing a primitive breaks the tier rules', () => {
    const problems = validateLocal(
      alias('component.b.c', 'primitive.n.one'),
      base,
      true,
    )
    expect(
      problems.some((p) => p.field === 'alias' || p.field === 'path'),
    ).toBe(true)
  })

  it('a token outside the three tiers is a path problem', () => {
    const problems = validateLocal(num('brand.color'), base, true)
    expect(problems.find((p) => p.field === 'path')?.message).toMatch(
      /primitive|semantic|component/,
    )
  })

  it('a token cannot also be a group, in either direction', () => {
    const under = validateLocal(num('primitive.n.one.deeper'), base, true)
    expect(under.some((p) => p.field === 'path')).toBe(true)
    const over = validateLocal(num('primitive.n'), base, true)
    expect(over.some((p) => p.field === 'path')).toBe(true)
  })

  it('a new token cannot reuse an existing path, but an edit can', () => {
    const create = validateLocal(num('primitive.n.one', 2), base, true)
    expect(
      create.some((p) => p.field === 'path' && /already/i.test(p.message)),
    ).toBe(true)
    const edit = validateLocal(num('primitive.n.one', 2), base, false)
    expect(edit).toEqual([])
  })

  it('an edit is checked against the OTHER tokens, not against its old self', () => {
    // changing the literal to an alias of a token that points back at it is a cycle
    const tokens = [num('semantic.n.a'), alias('semantic.n.b', 'semantic.n.a')]
    const problems = validateLocal(
      alias('semantic.n.a', 'semantic.n.b'),
      tokens,
      false,
    )
    expect(problems.length).toBeGreaterThan(0)
  })

  it('the 2000-token limit applies to creating, not editing', () => {
    const many = Array.from({ length: LIMITS.maxTokens }, (_, i) =>
      num(`primitive.n.t${i}`),
    )
    expect(
      validateLocal(num('primitive.n.new'), many, true).some(
        (p) => p.field === 'general',
      ),
    ).toBe(true)
    expect(validateLocal(num('primitive.n.t5', 9), many, false)).toEqual([])
  })
})
