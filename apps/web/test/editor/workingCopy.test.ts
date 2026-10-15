import type { Token } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import {
  buildListItems,
  filterItems,
  groupByTier,
} from '../../src/editor/groups'
import { readTokenList } from '../../src/editor/rows'
import { workingTokens, type Overlay } from '../../src/editor/workingCopy'
import type { ServerToken } from '../../src/api/types'

const row = (over: Partial<ServerToken> & { path: string }): ServerToken => ({
  type: 'number',
  value: 1,
  description: null,
  version: 1,
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
})

describe('readTokenList', () => {
  it('maps rows to tokens with their versions', () => {
    const { entries, unreadable } = readTokenList([
      row({ path: 'primitive.n.one', version: 3 }),
      row({
        path: 'semantic.n.a',
        type: null,
        value: '{primitive.n.one}',
        version: 7,
        description: 'why',
      }),
    ])
    expect(unreadable).toEqual([])
    expect(entries).toEqual([
      {
        token: { path: 'primitive.n.one', type: 'number', value: 1 },
        version: 3,
      },
      {
        token: {
          path: 'semantic.n.a',
          alias: 'primitive.n.one',
          description: 'why',
        },
        version: 7,
      },
    ])
  })

  it('keeps a corrupt row as "unreadable" (listed, with its version, so it can be deleted) and never throws', () => {
    const { entries, unreadable } = readTokenList([
      row({ path: 'primitive.n.ok' }),
      row({ path: 'primitive.n.bad', type: 'color', value: 'red', version: 9 }),
      row({ path: 'Not A Path', value: 1 }),
      row({ path: 'primitive.n.huge', type: 'number', value: { evil: true } }),
    ])
    expect(entries.map((e) => e.token.path)).toEqual(['primitive.n.ok'])
    expect(unreadable.map((u) => u.path)).toEqual([
      'primitive.n.bad',
      'Not A Path',
      'primitive.n.huge',
    ])
    expect(unreadable[0]).toMatchObject({ version: 9 })
    expect(unreadable[0]?.message.length).toBeGreaterThan(0)
  })

  it('a hostile value object does not throw', () => {
    const evil = JSON.parse(
      '{"__proto__":{"x":1},"colorSpace":"srgb"}',
    ) as unknown
    expect(() =>
      readTokenList([
        row({ path: 'primitive.c.x', type: 'color', value: evil }),
      ]),
    ).not.toThrow()
  })
})

describe('workingTokens: the server tokens plus an overlay', () => {
  const baseEntries = readTokenList([
    row({ path: 'primitive.n.a' }),
    row({ path: 'primitive.n.b', value: 2 }),
  ]).entries

  it('with no overlay it is the server tokens', () => {
    expect(workingTokens(baseEntries, new Map())).toEqual(
      baseEntries.map((e) => e.token),
    )
  })

  it('an edit replaces, an add inserts in path order, a delete removes', () => {
    const overlay: Overlay = new Map([
      [
        'primitive.n.a',
        {
          kind: 'edit',
          token: { path: 'primitive.n.a', type: 'number', value: 10 },
        },
      ],
      [
        'primitive.n.0',
        {
          kind: 'add',
          token: { path: 'primitive.n.0', type: 'number', value: 0 },
        },
      ],
      ['primitive.n.b', { kind: 'delete' }],
    ])
    const tokens = workingTokens(baseEntries, overlay)
    expect(tokens.map((t) => t.path)).toEqual([
      'primitive.n.0',
      'primitive.n.a',
    ])
    const a = tokens.find((t) => t.path === 'primitive.n.a') as Token & {
      value: number
    }
    expect(a.value).toBe(10)
  })

  it('does not change the base', () => {
    const before = structuredClone(baseEntries)
    workingTokens(baseEntries, new Map([['primitive.n.a', { kind: 'delete' }]]))
    expect(baseEntries).toEqual(before)
  })
})

describe('list items, grouping and filtering', () => {
  const tokens: Token[] = [
    {
      path: 'primitive.color.blue-500',
      type: 'color',
      value: { colorSpace: 'srgb', components: [0, 0, 1] },
      description: 'The brand blue',
    },
    {
      path: 'primitive.space.4',
      type: 'dimension',
      value: { value: 16, unit: 'px' },
    },
    { path: 'semantic.color.action', alias: 'primitive.color.blue-500' },
    { path: 'component.button.bg', alias: 'semantic.color.action' },
    { path: 'brand.loose', type: 'number', value: 1 },
  ]

  it('builds items with a text value, an effective type and never an empty value', () => {
    const items = buildListItems(tokens, [])
    const byPath = new Map(items.map((i) => [i.path, i]))
    expect(byPath.get('primitive.color.blue-500')).toMatchObject({
      type: 'color',
      display: '#0000ff',
    })
    expect(byPath.get('primitive.space.4')).toMatchObject({
      type: 'dimension',
      display: '16px',
    })
    expect(byPath.get('semantic.color.action')).toMatchObject({
      type: 'color',
      display: '{primitive.color.blue-500}',
    })
    expect(byPath.get('component.button.bg')?.type).toBe('color')
    // the swatch is the RESOLVED colour (an alias follows its target); other types have none
    expect(byPath.get('semantic.color.action')?.swatch).toBe('#0000ff')
    expect(byPath.get('component.button.bg')?.swatch).toBe('#0000ff')
    expect(byPath.get('primitive.space.4')?.swatch).toBeUndefined()
    for (const item of items) expect(item.display.length).toBeGreaterThan(0)
  })

  it('an alias with a missing target has no effective type but is still listed', () => {
    const items = buildListItems(
      [{ path: 'semantic.x', alias: 'primitive.nope' }],
      [],
    )
    expect(items[0]).toMatchObject({ path: 'semantic.x', type: null })
  })

  it('lists unreadable rows too, marked', () => {
    const items = buildListItems(
      [],
      [{ path: 'primitive.bad', version: 2, message: 'broken' }],
    )
    expect(items).toEqual([
      expect.objectContaining({ path: 'primitive.bad', unreadable: true }),
    ])
  })

  it('groups by tier, then by the first two path segments; loose tokens go to "other"', () => {
    const groups = groupByTier(buildListItems(tokens, []))
    expect(groups.primitive.map((g) => g.name)).toEqual([
      'primitive.color',
      'primitive.space',
    ])
    expect(groups.semantic.map((g) => g.name)).toEqual(['semantic.color'])
    expect(groups.component.map((g) => g.name)).toEqual(['component.button'])
    expect(groups.other.map((g) => g.name)).toEqual(['brand.loose'])
    expect(groups.primitive[0]?.items.map((i) => i.path)).toEqual([
      'primitive.color.blue-500',
    ])
  })

  it('filters case-insensitively over path, type, description and shown value', () => {
    const items = buildListItems(tokens, [])
    const paths = (q: string) => filterItems(items, q).map((i) => i.path)
    expect(paths('BLUE')).toEqual([
      'primitive.color.blue-500',
      'semantic.color.action',
    ])
    expect(paths('dimension')).toEqual(['primitive.space.4'])
    expect(paths('brand blue')).toEqual(['primitive.color.blue-500'])
    expect(paths('the brand blue')).toEqual(['primitive.color.blue-500'])
    expect(paths('16px')).toEqual(['primitive.space.4'])
    expect(paths('')).toHaveLength(items.length)
    expect(paths('   ')).toHaveLength(items.length)
  })

  it('a hostile query is just text', () => {
    const items = buildListItems(tokens, [])
    for (const q of [
      '.*',
      '(',
      '[',
      '\\',
      '<b>',
      '__proto__',
      'x'.repeat(10_000),
    ]) {
      expect(() => filterItems(items, q)).not.toThrow()
    }
  })
})
