import { describe, expect, it } from 'vitest'
import { flatten } from './tree'
import { resolve } from './resolve'
import { toCssVariables, type CssScope } from './css'
import type { Issue, ResolvedToken } from './types'
import {
  codes,
  color,
  colorA,
  dim,
  fontFamily,
  fontWeight,
  num,
} from './testHelpers'

/** The expected stylesheet for a list of declaration lines. */
function root(...lines: string[]): string {
  return `:root {\n${lines.map((line) => `  ${line}\n`).join('')}}\n`
}

/** The value of the only declaration in the export of one token. */
function valueOf(token: ResolvedToken): string {
  const { css, issues } = toCssVariables([token])
  expect(issues).toEqual([])
  const match = /^ {2}--[a-z0-9-]+: (.*);$/m.exec(css)
  if (match?.[1] === undefined) throw new Error(`no declaration in ${css}`)
  return match[1]
}

function bad(token: unknown): ResolvedToken {
  return token as ResolvedToken
}

describe('toCssVariables: output shape', () => {
  it('writes one sorted declaration per line inside :root by default', () => {
    const { css, issues } = toCssVariables([
      num('b.x', 2),
      color('a.y', [0, 0, 1]),
      dim('a.x', 4, 'rem'),
    ])
    expect(issues).toEqual([])
    expect(css).toBe(root('--a-x: 4rem;', '--a-y: #0000ff;', '--b-x: 2;'))
  })

  it('names variables with -- plus the path segments joined by hyphens', () => {
    const { css } = toCssVariables([num('primitive.color.blue-500')])
    expect(css).toBe(root('--primitive-color-blue-500: 1;'))
  })

  it('accepts an explicit root scope', () => {
    const { css } = toCssVariables([num('a')], { scope: { kind: 'root' } })
    expect(css).toBe(root('--a: 1;'))
  })

  it('scopes to a data-theme attribute built from a validated slug', () => {
    const { css, issues } = toCssVariables([num('a')], {
      scope: { kind: 'attribute', name: 'data-theme', value: 'acme-dark' },
    })
    expect(issues).toEqual([])
    expect(css).toBe('[data-theme="acme-dark"] {\n  --a: 1;\n}\n')
  })

  it('returns an empty string for no declarations', () => {
    expect(toCssVariables([])).toEqual({ css: '', issues: [] })
    expect(toCssVariables([num('a')], { include: [] })).toEqual({
      css: '',
      issues: [],
    })
  })

  it('orders numeric segments numerically and is independent of input order', () => {
    const tokens = [num('k.10'), num('k.2'), num('k.b'), num('k.a')]
    const forward = toCssVariables(tokens)
    expect(forward.css).toBe(
      root('--k-2: 1;', '--k-10: 1;', '--k-a: 1;', '--k-b: 1;'),
    )
    expect(toCssVariables([...tokens].reverse())).toEqual(forward)
  })

  it('never emits descriptions or comments', () => {
    const { css } = toCssVariables([{ ...num('a'), description: '*/ evil' }])
    expect(css).toBe(root('--a: 1;'))
  })
})

describe('toCssVariables: scope validation', () => {
  const invalidScopes: [string, unknown, string][] = [
    [
      'slug with a space',
      { kind: 'attribute', name: 'data-theme', value: 'Bad Slug' },
      'scope.value',
    ],
    [
      'slug that would close the selector',
      { kind: 'attribute', name: 'data-theme', value: 'a"]{' },
      'scope.value',
    ],
    [
      'empty slug',
      { kind: 'attribute', name: 'data-theme', value: '' },
      'scope.value',
    ],
    [
      'non-string slug',
      { kind: 'attribute', name: 'data-theme', value: 5 },
      'scope.value',
    ],
    [
      'uppercase slug',
      { kind: 'attribute', name: 'data-theme', value: 'Acme' },
      'scope.value',
    ],
    [
      'other attribute name',
      { kind: 'attribute', name: 'class', value: 'acme' },
      'scope.name',
    ],
    ['raw selector kind', { kind: 'selector', selector: 'body' }, 'scope.kind'],
    ['missing kind', { name: 'data-theme', value: 'acme' }, 'scope.kind'],
    ['a string instead of an object', 'root', 'scope'],
    ['null', null, 'scope'],
  ]

  it.each(invalidScopes)(
    'rejects %s and emits nothing',
    (_label, scope, field) => {
      const { css, issues } = toCssVariables([num('a')], {
        scope: scope as CssScope,
      })
      expect(css).toBe('')
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'INVALID_VALUE',
          severity: 'error',
          path: '',
          field,
        }),
      ])
    },
  )

  it('rejects an include list that is not an array', () => {
    const { css, issues } = toCssVariables([num('a')], {
      include: 'semantic' as unknown as ['semantic'],
    })
    expect(css).toBe('')
    expect(issues).toEqual([
      expect.objectContaining({ code: 'INVALID_VALUE', field: 'include' }),
    ])
  })
})

describe('toCssVariables: include', () => {
  const tokens = [
    num('primitive.a'),
    num('semantic.b'),
    num('component.c'),
    num('loose.d'),
  ]

  it('exports every token, including ones outside a tier, by default', () => {
    expect(toCssVariables(tokens).css).toBe(
      root(
        '--component-c: 1;',
        '--loose-d: 1;',
        '--primitive-a: 1;',
        '--semantic-b: 1;',
      ),
    )
  })

  it('keeps only the listed tiers when include is given', () => {
    expect(
      toCssVariables(tokens, { include: ['semantic', 'component'] }).css,
    ).toBe(root('--component-c: 1;', '--semantic-b: 1;'))
    expect(toCssVariables(tokens, { include: ['primitive'] }).css).toBe(
      root('--primitive-a: 1;'),
    )
  })
})

describe('toCssVariables: name collisions', () => {
  it('reports both tokens and omits them when two paths map to one name', () => {
    const { css, issues } = toCssVariables([
      color('a.b-c'),
      num('a-b.c'),
      num('z'),
    ])
    expect(css).toBe(root('--z: 1;'))
    expect(issues).toHaveLength(2)
    expect(codes(issues)).toEqual(['CSS_NAME_COLLISION', 'CSS_NAME_COLLISION'])
    for (const issue of issues) {
      expect(issue).toMatchObject({ severity: 'error' })
      expect(issue.related).toEqual(['a.b-c', 'a-b.c'])
      expect(issue.message).toContain('--a-b-c')
    }
    expect(issues.map((issue) => issue.path)).toEqual(['a.b-c', 'a-b.c'])
  })

  it('reports every member of a three-way collision', () => {
    const { css, issues } = toCssVariables([
      num('a.b-c'),
      num('a-b.c'),
      num('a-b-c'),
    ])
    expect(css).toBe('')
    expect(issues).toHaveLength(3)
    for (const issue of issues) {
      expect([...(issue.related ?? [])].sort()).toEqual(
        ['a-b-c', 'a-b.c', 'a.b-c'].sort(),
      )
    }
  })

  it('does not count tokens that are filtered out by include', () => {
    const { css, issues } = toCssVariables(
      [num('primitive.a.b-c'), num('primitive.a-b.c'), num('semantic.ok')],
      { include: ['semantic'] },
    )
    expect(issues).toEqual([])
    expect(css).toBe(root('--semantic-ok: 1;'))
  })
})

describe('toCssVariables: defensive checks on its input', () => {
  it.each(['a;}body{x:y}', 'Upper.case', 'a..b', '', 'a b', 'a.b{', '-a'])(
    'rejects the path %j with INVALID_NAME',
    (path) => {
      const { css, issues } = toCssVariables([num(path), num('ok')])
      expect(css).toBe(root('--ok: 1;'))
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'INVALID_NAME',
          severity: 'error',
          path,
        }),
      ])
    },
  )

  it('reports a duplicate path as PATH_CONFLICT and keeps the first token', () => {
    const { css, issues } = toCssVariables([num('a', 1), num('a', 2)])
    expect(css).toBe(root('--a: 1;'))
    expect(codes(issues)).toEqual(['PATH_CONFLICT'])
  })

  it.each([
    ['a color with a component out of range', color('a', [2, 0, 0])],
    [
      'a dimension with an unknown unit',
      bad({ path: 'a', type: 'dimension', value: { value: 1, unit: 'em' } }),
    ],
    [
      'a number holding a string',
      bad({ path: 'a', type: 'number', value: '1; } body { x: y' }),
    ],
    ['a font family with a newline', fontFamily('a', 'x\ny')],
    ['a font family with a lone surrogate', fontFamily('a', 'x\ud800')],
    ['a font family with a NUL byte', fontFamily('a', ['ok', 'x\u0000'])],
    ['a font weight outside the range', fontWeight('a', 5000)],
  ])('omits %s with INVALID_VALUE', (_label, token) => {
    const { css, issues } = toCssVariables([token, num('ok')])
    expect(css).toBe(root('--ok: 1;'))
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['INVALID_VALUE', 'a'],
    ])
  })

  it('omits a token of an unsupported type with INVALID_TYPE instead of throwing', () => {
    const { css, issues } = toCssVariables([
      bad({ path: 'a', type: 'shadow', value: {} }),
      num('ok'),
    ])
    expect(css).toBe(root('--ok: 1;'))
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_TYPE',
        path: 'a',
        field: 'type',
      }),
    ])
  })

  it('does not repeat warnings that flatten already reported', () => {
    const { css, issues } = toCssVariables([
      colorA('a', [1, 0, 0], undefined, '#00ff00'),
    ])
    expect(issues).toEqual([])
    expect(css).toBe(root('--a: #ff0000;'))
  })
})

describe('toCssVariables: color values', () => {
  it('writes #rrggbb for opaque colors with 8-bit rounding', () => {
    expect(valueOf(color('a', [1, 0, 0]))).toBe('#ff0000')
    expect(valueOf(color('a', [0.5, 0.5, 0.5]))).toBe('#808080')
    expect(valueOf(color('a', [0.145, 0.388, 0.922]))).toBe('#2563eb')
  })

  it('treats alpha 1 and a missing alpha as opaque', () => {
    expect(valueOf(colorA('a', [0, 0, 1], 1))).toBe('#0000ff')
    expect(valueOf(colorA('a', [0, 0, 1]))).toBe('#0000ff')
  })

  it('writes rgb(r g b / a) for translucent colors', () => {
    expect(valueOf(colorA('a', [1, 0, 0], 0.5))).toBe('rgb(255 0 0 / 0.5)')
    expect(valueOf(colorA('a', [0, 0.2, 1], 0.25))).toBe('rgb(0 51 255 / 0.25)')
    expect(valueOf(colorA('a', [0, 0, 0], 0))).toBe('rgb(0 0 0 / 0)')
  })

  it('rounds alpha to three decimals and treats a value that rounds to 1 as opaque', () => {
    expect(valueOf(colorA('a', [1, 0, 0], 0.3333))).toBe('rgb(255 0 0 / 0.333)')
    expect(valueOf(colorA('a', [1, 0, 0], 0.9996))).toBe('#ff0000')
    expect(valueOf(colorA('a', [1, 0, 0], 0.0004))).toBe('rgb(255 0 0 / 0)')
  })

  it('computes from the components, not the hex fallback', () => {
    expect(valueOf(colorA('a', [1, 0, 0], undefined, '#00ff00'))).toBe(
      '#ff0000',
    )
  })
})

describe('toCssVariables: dimension, number and fontWeight values', () => {
  it('writes dimensions as value + unit', () => {
    expect(valueOf(dim('a', 16, 'px'))).toBe('16px')
    expect(valueOf(dim('a', 0.5, 'rem'))).toBe('0.5rem')
    expect(valueOf(dim('a', 0, 'px'))).toBe('0px')
    expect(valueOf(dim('a', -4, 'px'))).toBe('-4px')
  })

  it('writes numbers plainly', () => {
    expect(valueOf(num('a', 1))).toBe('1')
    expect(valueOf(num('a', -1.5))).toBe('-1.5')
    expect(valueOf(num('a', -0))).toBe('0')
  })

  it('writes numeric font weights as they are', () => {
    expect(valueOf(fontWeight('a', 400))).toBe('400')
    expect(valueOf(fontWeight('a', 350))).toBe('350')
  })

  it.each([
    ['thin', '100'],
    ['regular', '400'],
    ['bold', '700'],
    ['heavy', '900'],
    ['extra-black', '950'],
  ])('converts the DTCG weight name %j to %s', (name, expected) => {
    expect(valueOf(fontWeight('a', name))).toBe(expected)
  })
})

describe('toCssVariables: fontFamily values', () => {
  const family = (value: string | string[]) => valueOf(fontFamily('a', value))

  it('leaves simple identifiers and generic families unquoted', () => {
    expect(family('Inter')).toBe('Inter')
    expect(family(['Roboto2', 'Open_Sans', 'sans-serif'])).toBe(
      'Roboto2, Open_Sans, sans-serif',
    )
  })

  it.each([
    'serif',
    'sans-serif',
    'system-ui',
    'cursive',
    'fantasy',
    'math',
    'monospace',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
  ])('writes the generic family %j unquoted', (name) => {
    expect(family(name)).toBe(name)
  })

  it('matches generic families case-insensitively and writes them lower-case', () => {
    expect(family('SERIF')).toBe('serif')
    expect(family('Sans-Serif')).toBe('sans-serif')
  })

  it('allows one leading hyphen so vendor keywords stay unquoted', () => {
    expect(
      family([
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'sans-serif',
      ]),
    ).toBe('-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif')
  })

  it.each([
    ['Helvetica Neue', '"Helvetica Neue"'],
    ['21st Century', '"21st Century"'],
    ['--custom', '"--custom"'],
    ['-1abc', '"-1abc"'],
    ['Noto Sans 日本語', '"Noto Sans 日本語"'],
    ['Café', '"Café"'],
    ['a.b', '"a.b"'],
    ['inherit', '"inherit"'],
    ['Initial', '"Initial"'],
    ['unset', '"unset"'],
    ['revert', '"revert"'],
    ['revert-layer', '"revert-layer"'],
    ['default', '"default"'],
  ])('quotes %j', (name, expected) => {
    expect(family(name)).toBe(expected)
  })

  it('joins a list with a comma and a space', () => {
    expect(family(['Helvetica Neue', 'Arial', 'sans-serif'])).toBe(
      '"Helvetica Neue", Arial, sans-serif',
    )
  })

  it.each([
    [
      'Arial"; } body { display:none } /*',
      '"Arial\\"; } body { display:none } /*"',
    ],
    ['</style><script>', '"\\3c /style>\\3c script>"'],
    ['<!--', '"\\3c !--"'],
    ['back\\slash', '"back\\\\slash"'],
    ['\\3c', '"\\\\3c"'],
    ['say "hi"', '"say \\"hi\\""'],
    ['a< b', '"a\\3c  b"'],
  ])('escapes %j inside quotes', (name, expected) => {
    expect(family(name)).toBe(expected)
  })
})

describe('toCssVariables: end to end', () => {
  it('exports resolved values, not var() chains', () => {
    const flat = flatten({
      primitive: {
        color: {
          'blue-500': {
            $type: 'color',
            $value: { colorSpace: 'srgb', components: [0.145, 0.388, 0.922] },
          },
        },
      },
      semantic: { color: { action: { $value: '{primitive.color.blue-500}' } } },
      component: {
        button: { background: { $value: '{semantic.color.action}' } },
      },
    })
    expect(flat.issues).toEqual([])
    const { resolved, issues: resolveIssues } = resolve(flat.tokens)
    expect(resolveIssues).toEqual([])

    const { css, issues } = toCssVariables(resolved)
    expect(issues).toEqual<Issue[]>([])
    expect(css).toBe(
      root(
        '--component-button-background: #2563eb;',
        '--primitive-color-blue-500: #2563eb;',
        '--semantic-color-action: #2563eb;',
      ),
    )
    expect(css).not.toContain('var(')
  })
})
