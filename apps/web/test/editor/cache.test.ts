import { describe, expect, it } from 'vitest'
import type { ServerToken, TokenList } from '../../src/api/types'
import { withoutToken, withSavedToken } from '../../src/editor/cache'

const tok = (path: string, version = 1): ServerToken => ({
  path,
  type: 'number',
  value: 1,
  description: null,
  version,
  updatedAt: '2026-10-13T10:00:00.000Z',
})

const list: TokenList = {
  draftRevision: 5,
  tokens: [tok('primitive.a', 2), tok('primitive.c', 3)],
}

describe('cache updates after a write', () => {
  it('a saved token replaces the old row, in path order, and sets the new revision', () => {
    const next = withSavedToken(list, tok('primitive.a', 6), 6)
    expect(next.draftRevision).toBe(6)
    expect(next.tokens.map((t) => [t.path, t.version])).toEqual([
      ['primitive.a', 6],
      ['primitive.c', 3],
    ])
  })

  it('a created token is inserted where it sorts (numeric segments numerically)', () => {
    const base: TokenList = {
      draftRevision: 1,
      tokens: [tok('primitive.s.9'), tok('primitive.s.100')],
    }
    const next = withSavedToken(base, tok('primitive.s.10'), 2)
    expect(next.tokens.map((t) => t.path)).toEqual([
      'primitive.s.9',
      'primitive.s.10',
      'primitive.s.100',
    ])
  })

  it('a deleted token is removed and the revision moves', () => {
    const next = withoutToken(list, 'primitive.a', 6)
    expect(next).toEqual({ draftRevision: 6, tokens: [list.tokens[1]] })
  })

  it('deleting a path that is not there only moves the revision', () => {
    expect(withoutToken(list, 'primitive.zzz', 6).tokens).toHaveLength(2)
  })

  it('does not change its input', () => {
    const before = structuredClone(list)
    withSavedToken(list, tok('primitive.a', 6), 6)
    withoutToken(list, 'primitive.a', 6)
    expect(list).toEqual(before)
  })
})
