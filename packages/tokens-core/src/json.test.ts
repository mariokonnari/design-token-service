import { describe, expect, it } from 'vitest'
import { resolve } from './resolve'
import { toResolvedTree } from './json'
import { flatten } from './tree'
import type { ResolvedToken, Token } from './types'
import { codes, color, fontWeight, num } from './testHelpers'

const blue = { colorSpace: 'srgb', components: [0.145, 0.388, 0.922] }

function resolvedFrom(tree: unknown) {
  const flat = flatten(tree)
  expect(flat.issues).toEqual([])
  const result = resolve(flat.tokens)
  expect(result.issues).toEqual([])
  return result.resolved
}

/** A resolved token without the alias bookkeeping, comparable to a literal token. */
function literalOf(token: ResolvedToken): Token {
  const literal = {
    path: token.path,
    type: token.type,
    value: token.value,
  } as Token
  if (token.description !== undefined) literal.description = token.description
  return literal
}

describe('toResolvedTree', () => {
  const resolved = resolvedFrom({
    primitive: { color: { 'blue-500': { $type: 'color', $value: blue } } },
    semantic: {
      color: {
        action: {
          $value: '{primitive.color.blue-500}',
          $description: 'Primary action',
        },
      },
    },
    component: {
      button: { background: { $value: '{semantic.color.action}' } },
    },
  })

  it('builds a nested tree of literal tokens only', () => {
    const { tree, issues } = toResolvedTree(resolved)
    expect(issues).toEqual([])
    expect(tree).toEqual({
      primitive: { color: { 'blue-500': { $type: 'color', $value: blue } } },
      semantic: {
        color: {
          action: {
            $type: 'color',
            $value: blue,
            $description: 'Primary action',
          },
        },
      },
      component: {
        button: { background: { $type: 'color', $value: blue } },
      },
    })
  })

  it('contains no alias references or alias bookkeeping', () => {
    const text = JSON.stringify(toResolvedTree(resolved).tree)
    expect(text).not.toContain('aliasOf')
    expect(text).not.toContain('resolvesTo')
    expect(text).not.toMatch(/"\{[^"]*\}"/)
  })

  it('round-trips through flatten back to the same literal tokens', () => {
    const { tree } = toResolvedTree(resolved)
    const again = flatten(tree)
    expect(again.issues).toEqual([])
    expect(again.tokens).toEqual(resolved.map(literalOf))
  })

  it('keeps fontWeight names as written (only CSS converts them)', () => {
    const { tree } = toResolvedTree([fontWeight('text.weight', 'bold')])
    expect(tree).toEqual({
      text: { weight: { $type: 'fontWeight', $value: 'bold' } },
    })
  })

  it('does not share value objects with its input', () => {
    const token = color('c', [0, 0, 0])
    const { tree } = toResolvedTree([token])
    if (token.type === 'color') token.value.components[0] = 1
    expect(tree).toEqual({
      c: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [0, 0, 0] },
      },
    })
  })

  it('returns an empty tree for no tokens', () => {
    expect(toResolvedTree([])).toEqual({ tree: {}, issues: [] })
  })

  it('passes nest() issues through: PATH_CONFLICT and INVALID_NAME', () => {
    const conflict = toResolvedTree([num('a.b'), num('a')])
    expect(codes(conflict.issues)).toEqual(['PATH_CONFLICT'])
    expect(conflict.tree).toEqual({ a: { $type: 'number', $value: 1 } })

    const invalid = toResolvedTree([num('Bad.name'), num('ok')])
    expect(codes(invalid.issues)).toEqual(['INVALID_NAME'])
    expect(invalid.tree).toEqual({ ok: { $type: 'number', $value: 1 } })
  })
})
