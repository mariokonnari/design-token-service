import { describe, expect, it } from 'vitest'
import { flatten, nest } from './tree'
import { alias, codes, color, num } from './testHelpers'

const rgb = { colorSpace: 'srgb', components: [0, 0, 1] }
const one = { $type: 'number', $value: 1 }

describe('flatten: structure', () => {
  it('flattens nested groups into dotted paths, sorted by path', () => {
    const { tokens, issues, rejected } = flatten({
      b: { y: one, x: one },
      a: { n: { deep: one } },
    })
    expect(tokens.map((token) => token.path)).toEqual([
      'a.n.deep',
      'b.x',
      'b.y',
    ])
    expect(issues).toEqual([])
    expect(rejected).toEqual([])
  })

  it('produces typed literal tokens', () => {
    const { tokens } = flatten({
      color: { blue: { $type: 'color', $value: rgb } },
    })
    expect(tokens).toEqual([{ path: 'color.blue', type: 'color', value: rgb }])
  })

  it('treats an empty document and empty groups as having no tokens', () => {
    expect(flatten({})).toEqual({ tokens: [], issues: [], rejected: [] })
    expect(flatten({ a: { b: {} } })).toEqual({
      tokens: [],
      issues: [],
      rejected: [],
    })
  })

  it('keeps token descriptions and silently drops group descriptions', () => {
    const { tokens, issues } = flatten({
      $description: 'root',
      g: {
        $description: 'a group',
        t: { $type: 'number', $value: 1, $description: 'a token' },
      },
    })
    expect(issues).toEqual([])
    expect(tokens).toEqual([
      { path: 'g.t', type: 'number', value: 1, description: 'a token' },
    ])
  })

  it('is deterministic regardless of key order in the input', () => {
    const forward = {
      a: { x: one, y: { $type: 'color', $value: 'nope' } },
      b: { Bad: one, z: one },
    }
    const reversed = {
      b: { z: one, Bad: one },
      a: { y: { $type: 'color', $value: 'nope' }, x: one },
    }
    expect(flatten(reversed)).toEqual(flatten(forward))
  })

  it('sorts issues by path', () => {
    const { issues } = flatten({ b: { $value: 1 }, a: { $value: 1 } })
    expect(issues.map((issue) => issue.path)).toEqual(['a', 'b'])
  })
})

describe('flatten: $type inheritance', () => {
  it('inherits from the closest group, and explicit $type wins', () => {
    const { tokens, issues } = flatten({
      $type: 'number',
      root: { $value: 7 },
      color: {
        $type: 'color',
        blue: { $value: rgb },
        nested: {
          green: { $value: rgb },
          size: { $type: 'dimension', $value: { value: 1, unit: 'px' } },
          inner: { $type: 'number', n: { $value: 3 } },
        },
      },
    })
    expect(issues).toEqual([])
    expect(
      Object.fromEntries(
        tokens.map((token) => [
          token.path,
          'type' in token ? token.type : null,
        ]),
      ),
    ).toEqual({
      root: 'number',
      'color.blue': 'color',
      'color.nested.green': 'color',
      'color.nested.size': 'dimension',
      'color.nested.inner.n': 'number',
    })
  })

  it('does not apply a group $type to an alias token (type comes from the target)', () => {
    const { tokens, issues } = flatten({
      size: {
        $type: 'dimension',
        link: { $value: '{color.blue}' },
      },
    })
    expect(issues).toEqual([])
    expect(tokens).toEqual([{ path: 'size.link', alias: 'color.blue' }])
  })

  it('keeps an explicit $type declared on an alias token', () => {
    const { tokens } = flatten({
      link: { $type: 'color', $value: '{color.blue}' },
    })
    expect(tokens).toEqual([
      { path: 'link', alias: 'color.blue', type: 'color' },
    ])
  })

  it('reports MISSING_TYPE when no type can be determined', () => {
    const { tokens, issues, rejected } = flatten({ a: { $value: 1 } })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'MISSING_TYPE',
        severity: 'error',
        path: 'a',
        field: '$type',
      }),
    ])
    expect(rejected).toEqual(['a'])
  })
})

describe('flatten: names', () => {
  it('reports INVALID_NAME for bad names and skips their subtrees', () => {
    const { tokens, issues, rejected } = flatten({
      Color: { x: one },
      a_b: one,
      ok: one,
      color: { 'Blue-500': one },
    })
    expect(tokens.map((token) => token.path)).toEqual(['ok'])
    expect(
      issues.map((issue) => [issue.code, issue.severity, issue.path]),
    ).toEqual([
      ['INVALID_NAME', 'error', 'Color'],
      ['INVALID_NAME', 'error', 'a_b'],
      ['INVALID_NAME', 'error', 'color.Blue-500'],
    ])
    // Paths that cannot be written as an alias target are not "rejected tokens".
    expect(rejected).toEqual([])
  })

  it('rejects a __proto__ key coming from JSON.parse', () => {
    const tree: unknown = JSON.parse(
      '{"__proto__": {"$type": "number", "$value": 1}}',
    )
    const { tokens, issues } = flatten(tree)
    expect(tokens).toEqual([])
    expect(codes(issues)).toEqual(['INVALID_NAME'])
  })
})

describe('flatten: type errors', () => {
  it.each([['colour'], [5], [null], [['color']]])(
    'reports INVALID_TYPE for token $type %j',
    (type) => {
      const { tokens, issues, rejected } = flatten({
        a: { $type: type, $value: 1 },
      })
      expect(tokens).toEqual([])
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'INVALID_TYPE',
          path: 'a',
          field: '$type',
        }),
      ])
      expect(rejected).toEqual(['a'])
    },
  )

  it.each([
    'duration',
    'cubicBezier',
    'strokeStyle',
    'border',
    'transition',
    'shadow',
    'gradient',
    'typography',
  ])('reports UNSUPPORTED_TYPE for the spec type %j', (type) => {
    const { tokens, issues, rejected } = flatten({
      a: { $type: type, $value: {} },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_TYPE',
        severity: 'error',
        path: 'a',
        field: '$type',
      }),
    ])
    expect(rejected).toEqual(['a'])
  })

  it('reports a bad group $type once and skips only tokens that rely on it', () => {
    const { tokens, issues, rejected } = flatten({
      g: {
        $type: 'colour',
        inherits: { $value: 1 },
        explicit: { $type: 'number', $value: 2 },
        link: { $value: '{somewhere}' },
      },
    })
    expect(tokens.map((token) => token.path)).toEqual(['g.explicit', 'g.link'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_TYPE',
        path: 'g',
        field: '$type',
      }),
    ])
    expect(rejected).toEqual(['g.inherits'])
  })

  it('reports an unsupported group $type once at the group', () => {
    const { tokens, issues } = flatten({
      g: { $type: 'typography', a: { $value: {} }, b: { $value: {} } },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({ code: 'UNSUPPORTED_TYPE', path: 'g' }),
    ])
  })

  it('lets the closest group decide, even when it is invalid', () => {
    const { tokens, issues } = flatten({
      $type: 'number',
      g: { $type: 'colour', a: { $value: 1 } },
    })
    expect(tokens).toEqual([])
    expect(codes(issues)).toEqual(['INVALID_TYPE'])
  })
})

describe('flatten: literal validation', () => {
  it('rejects tokens whose value fails validation, keeping the field', () => {
    const { tokens, issues, rejected } = flatten({
      c: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [2, 0, 0] },
      },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_VALUE',
        path: 'c',
        field: '$value.components[0]',
      }),
    ])
    expect(rejected).toEqual(['c'])
  })

  it('passes UNSUPPORTED_COLOR_SPACE through', () => {
    const { issues, rejected } = flatten({
      c: {
        $type: 'color',
        $value: { colorSpace: 'display-p3', components: [0, 0, 0] },
      },
    })
    expect(codes(issues)).toEqual(['UNSUPPORTED_COLOR_SPACE'])
    expect(rejected).toEqual(['c'])
  })

  it('keeps a token that only has a HEX_MISMATCH warning', () => {
    const { tokens, issues, rejected } = flatten({
      c: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [1, 0, 0], hex: '#00ff00' },
      },
    })
    expect(tokens.map((token) => token.path)).toEqual(['c'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'HEX_MISMATCH',
        severity: 'warning',
        path: 'c',
        field: '$value.hex',
      }),
    ])
    expect(rejected).toEqual([])
  })

  it.each(['{a..b}', '{}', '{Color.Blue}', '{{a}}'])(
    'reports a malformed alias %j as INVALID_VALUE',
    (value) => {
      const { tokens, issues, rejected } = flatten({
        a: { $type: 'number', $value: value },
      })
      expect(tokens).toEqual([])
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'INVALID_VALUE',
          path: 'a',
          field: '$value',
        }),
      ])
      expect(rejected).toEqual(['a'])
    },
  )
})

describe('flatten: invalid structure', () => {
  it.each([[null], [[]], [5], ['x'], [undefined], [true]])(
    'reports INVALID_STRUCTURE for a root of %j',
    (root) => {
      const { tokens, issues } = flatten(root)
      expect(tokens).toEqual([])
      expect(issues).toEqual([
        expect.objectContaining({ code: 'INVALID_STRUCTURE', path: '' }),
      ])
    },
  )

  it('reports INVALID_STRUCTURE when the root itself has a $value', () => {
    const { issues } = flatten({ $type: 'number', $value: 1 })
    expect(issues).toEqual([
      expect.objectContaining({ code: 'INVALID_STRUCTURE', path: '' }),
    ])
  })

  it('reports non-object children and marks them rejected', () => {
    const { tokens, issues, rejected } = flatten({
      a: null,
      b: 3,
      c: [],
      d: 'x',
    })
    expect(tokens).toEqual([])
    expect(codes(issues)).toEqual([
      'INVALID_STRUCTURE',
      'INVALID_STRUCTURE',
      'INVALID_STRUCTURE',
      'INVALID_STRUCTURE',
    ])
    expect(rejected).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reports an object with both $value and children (spec 6.1)', () => {
    const { tokens, issues, rejected } = flatten({
      a: { $type: 'number', $value: 1, child: one },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({ code: 'INVALID_STRUCTURE', path: 'a' }),
    ])
    expect(rejected).toEqual(['a'])
  })

  it('rejects a token with a non-string $description', () => {
    const { tokens, issues, rejected } = flatten({
      a: { $type: 'number', $value: 1, $description: 5 },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_STRUCTURE',
        path: 'a',
        field: '$description',
      }),
    ])
    expect(rejected).toEqual(['a'])
  })

  it('reports a non-string group $description but still reads its children', () => {
    const { tokens, issues } = flatten({ g: { $description: 5, t: one } })
    expect(tokens.map((token) => token.path)).toEqual(['g.t'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_STRUCTURE',
        path: 'g',
        field: '$description',
      }),
    ])
  })

  it('reports a non-string group $type as INVALID_TYPE', () => {
    const { issues } = flatten({ g: { $type: 5, t: one } })
    expect(codes(issues)).toEqual(['INVALID_TYPE'])
  })

  it('never throws on garbage and handles very deep nesting', () => {
    for (const garbage of [
      undefined,
      null,
      1,
      'x',
      [],
      [[]],
      { a: { b: { c: null } } },
      { a: { $value: undefined } },
    ]) {
      expect(() => flatten(garbage)).not.toThrow()
    }

    let deep: Record<string, unknown> = { $type: 'number', $value: 1 }
    for (let i = 0; i < 5000; i++) deep = { a: deep }
    const { tokens, issues } = flatten(deep)
    expect(issues).toEqual([])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.path.split('.')).toHaveLength(5000)
  })
})

describe('flatten: unsupported features', () => {
  it('reports $extends on a group but still reads the group', () => {
    const { tokens, issues } = flatten({ g: { $extends: '{base}', t: one } })
    expect(tokens.map((token) => token.path)).toEqual(['g.t'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_FEATURE',
        severity: 'error',
        path: 'g',
        field: '$extends',
      }),
    ])
  })

  it('reports a $root token and does not emit it', () => {
    const { tokens, issues } = flatten({ g: { $root: one, t: one } })
    expect(tokens.map((token) => token.path)).toEqual(['g.t'])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_FEATURE',
        severity: 'error',
        path: 'g.$root',
      }),
    ])
  })

  it('reports a $ref token (no $value) and marks it rejected', () => {
    const { tokens, issues, rejected } = flatten({
      s: { $type: 'number', $ref: '#/other/$value' },
    })
    expect(tokens).toEqual([])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'UNSUPPORTED_FEATURE',
        severity: 'error',
        path: 's',
        field: '$ref',
      }),
    ])
    expect(rejected).toEqual(['s'])
  })

  it('rejects a token that has both $value and $ref', () => {
    const { tokens, issues, rejected } = flatten({
      s: { $type: 'number', $value: 1, $ref: '#/x' },
    })
    expect(tokens).toEqual([])
    expect(codes(issues)).toEqual(['UNSUPPORTED_FEATURE'])
    expect(rejected).toEqual(['s'])
  })

  it('warns about ignored $deprecated, $extensions and unknown $ properties', () => {
    const { tokens, issues } = flatten({
      g: { $deprecated: true, $extensions: {}, $mystery: 1, t: one },
      u: {
        $type: 'number',
        $value: 1,
        $deprecated: 'old',
        $extensions: { x: 1 },
        $foo: 1,
      },
    })
    expect(tokens.map((token) => token.path)).toEqual(['g.t', 'u'])
    expect(
      issues.map((issue) => [
        issue.code,
        issue.severity,
        issue.path,
        issue.field,
      ]),
    ).toEqual([
      ['UNSUPPORTED_FEATURE', 'warning', 'g', '$deprecated'],
      ['UNSUPPORTED_FEATURE', 'warning', 'g', '$extensions'],
      ['UNSUPPORTED_FEATURE', 'warning', 'g', '$mystery'],
      ['UNSUPPORTED_FEATURE', 'warning', 'u', '$deprecated'],
      ['UNSUPPORTED_FEATURE', 'warning', 'u', '$extensions'],
      ['UNSUPPORTED_FEATURE', 'warning', 'u', '$foo'],
    ])
  })
})

describe('nest', () => {
  it('builds a DTCG-style tree from tokens', () => {
    const { tree, issues } = nest([
      color('color.blue.500', [0, 0, 1]),
      alias('color.link', 'color.blue.500'),
      alias('color.strict', 'color.blue.500', 'color'),
      { ...num('size.one'), description: 'one' },
    ])
    expect(issues).toEqual([])
    expect(tree).toEqual({
      color: {
        blue: { '500': { $type: 'color', $value: rgb } },
        link: { $value: '{color.blue.500}' },
        strict: { $type: 'color', $value: '{color.blue.500}' },
      },
      size: { one: { $type: 'number', $value: 1, $description: 'one' } },
    })
  })

  it('round-trips a canonical tree (explicit $type everywhere)', () => {
    const canonical = {
      primitive: {
        color: { blue: { $type: 'color', $value: rgb, $description: 'Blue' } },
        space: {
          '4': { $type: 'dimension', $value: { value: 4, unit: 'px' } },
        },
        font: { $type: 'fontFamily', $value: ['Inter', 'sans-serif'] },
      },
      semantic: { link: { $value: '{primitive.color.blue}' } },
    }
    const flat = flatten(canonical)
    expect(flat.issues).toEqual([])
    const nested = nest(flat.tokens)
    expect(nested.issues).toEqual([])
    expect(nested.tree).toEqual(canonical)
  })

  it('emits keys in the same order flatten sorts paths (numeric first)', () => {
    const { tree } = nest([num('s.b'), num('s.10'), num('s.a'), num('s.2')])
    expect(Object.keys(tree.s as object)).toEqual(['2', '10', 'a', 'b'])
  })

  it('reports PATH_CONFLICT when a token path is also a group', () => {
    const { tree, issues } = nest([num('a.b'), num('a')])
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PATH_CONFLICT',
        severity: 'error',
        path: 'a.b',
        related: ['a'],
      }),
    ])
    expect(tree).toEqual({ a: { $type: 'number', $value: 1 } })
  })

  it('reports PATH_CONFLICT for a duplicate path and keeps the first', () => {
    const { tree, issues } = nest([num('a', 1), num('a', 2)])
    expect(codes(issues)).toEqual(['PATH_CONFLICT'])
    expect(tree).toEqual({ a: { $type: 'number', $value: 1 } })
  })

  it('reports INVALID_NAME for tokens whose path cannot be written as a tree', () => {
    const { tree, issues } = nest([
      num('Color.x'),
      num(''),
      num('a..b'),
      num('ok'),
    ])
    expect(codes(issues)).toEqual([
      'INVALID_NAME',
      'INVALID_NAME',
      'INVALID_NAME',
    ])
    expect(tree).toEqual({ ok: { $type: 'number', $value: 1 } })
  })

  it('handles names that collide with Object.prototype members', () => {
    const { tree, issues } = nest([num('constructor.x'), num('constructor2')])
    expect(issues).toEqual([])
    expect(Object.hasOwn(tree, 'constructor')).toBe(true)
  })

  it('does not share value objects with the input tokens', () => {
    const token = color('c', [0, 0, 0])
    const { tree } = nest([token])
    if (token.type === 'color') token.value.components[0] = 1
    expect(tree).toEqual({
      c: {
        $type: 'color',
        $value: { colorSpace: 'srgb', components: [0, 0, 0] },
      },
    })
  })
})
