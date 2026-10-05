import * as csstree from 'css-tree'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toCssVariables, type CssScope } from '../src/css'
import { codes, colorA, dim, fontFamily } from '../src/testHelpers'
import type { ResolvedToken } from '../src/types'
import { expectCleanExport, parseCss } from './support/cssOracle'
import { scanCss } from './support/cssScan'

const SCOPES: { label: string; scope: CssScope; selector: string }[] = [
  { label: 'root', scope: { kind: 'root' }, selector: ':root' },
  {
    label: 'data-theme attribute',
    scope: { kind: 'attribute', name: 'data-theme', value: 'acme-dark' },
    selector: '[data-theme="acme-dark"]',
  },
]

const NAMES = ['--theme-color', '--theme-font', '--theme-size']
const GRAMMAR = {
  '--theme-color': 'color',
  '--theme-font': 'font-family',
  '--theme-size': 'margin-left',
}

/** A fixed token set with the hostile font family in the middle. */
function tokensWith(family: string | string[]): ResolvedToken[] {
  return [
    colorA('theme.color', [0, 0, 1]),
    fontFamily('theme.font', family),
    dim('theme.size', 4, 'px'),
  ]
}

/** Both independent checks plus the exact promises of the format. */
function expectSafe(css: string, selector: string, names = NAMES) {
  expect(scanCss(css)).toEqual([])
  expectCleanExport(css, { selector, names, grammar: GRAMMAR })
  expect(css).not.toContain('<')
}

const HOSTILE_FAMILIES: [string, string | string[]][] = [
  ['closes the declaration and rule', 'Arial"; } body { display:none } /*'],
  ['closes the style element', '</style><script>alert(1)</script>'],
  ['an HTML comment', '<!-- --><script>'],
  ['a backslash then a quote', '\\"; } *{display:none}/*'],
  ['a trailing backslash', 'abc\\'],
  ['a lone quote', '"'],
  ['single quotes and braces', "'; } x{y:z"],
  ['an escape spelled out', '\\3c /style>'],
  ['only braces and semicolons', '}{;};'],
  ['comment delimiters', '/* */ */ /*'],
  ['an @import', '@import url(//evil.example/x.css);'],
  ['a url()', 'url(javascript:alert(1))'],
  ['an expression()', 'expression(alert(1))'],
  ['a custom property reference', 'var(--x)'],
  ['a huge run of quotes', '"'.repeat(5000)],
  ['a huge run of backslashes', '\\'.repeat(5000)],
  ['a huge run of angle brackets', '<'.repeat(5000)],
  ['non-ASCII text', 'Noto Sans 日本語 \ud83d\ude00'],
  [
    'hostile entries inside a list',
    ['Inter', 'a"; } b { c:d } /*', '</style>'],
  ],
]

describe.each(SCOPES)('hostile fontFamily values ($label scope)', (entry) => {
  it.each(HOSTILE_FAMILIES)('is contained: %s', (_label, family) => {
    const { css, issues } = toCssVariables(tokensWith(family), {
      scope: entry.scope,
    })
    expect(issues).toEqual([])
    expectSafe(css, entry.selector)
  })
})

describe('hostile fontFamily values: exact output', () => {
  it('quotes and escapes the declaration-closing attempt', () => {
    const { css } = toCssVariables([
      fontFamily('theme.font', 'Arial"; } body { display:none } /*'),
    ])
    expect(css).toBe(
      ':root {\n  --theme-font: "Arial\\"; } body { display:none } /*";\n}\n',
    )
  })

  it('escapes < so the style element cannot be closed', () => {
    const { css } = toCssVariables([
      fontFamily('theme.font', '</style><script>'),
    ])
    expect(css).toBe(
      ':root {\n  --theme-font: "\\3c /style>\\3c script>";\n}\n',
    )
  })
})

describe('inputs that are rejected instead of escaped', () => {
  it.each([
    ['a newline', 'Arial\n} body { x:y'],
    ['a carriage return', 'a\rb'],
    ['a NUL byte', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
    ['a lone high surrogate', 'a\ud800b'],
    ['a lone low surrogate', 'a\udc00b'],
    ['an empty name', ''],
    ['a blank name', '   '],
  ])('omits a font family with %s and reports it', (_label, family) => {
    const { css, issues } = toCssVariables(tokensWith(family))
    expect(codes(issues)).toEqual(['INVALID_VALUE'])
    expect(issues[0]?.path).toBe('theme.font')
    expectSafe(css, ':root', ['--theme-color', '--theme-size'])
    expect(css).not.toContain('--theme-font')
  })
})

describe('the exporter cannot be steered by hostile structure', () => {
  it('rejects hostile paths instead of writing them into a name', () => {
    const { css, issues } = toCssVariables([
      dim('a;}body{x:y}', 1),
      dim('theme.size', 4, 'px'),
    ])
    expect(codes(issues)).toEqual(['INVALID_NAME'])
    expectSafe(css, ':root', ['--theme-size'])
  })

  it.each([
    'a"]{',
    'x"] { display:none } [y="',
    'Acme',
    '',
    'a b',
    'a;b',
    '</style>',
  ])('rejects the slug %j instead of writing it into a selector', (value) => {
    const { css, issues } = toCssVariables(tokensWith('Inter'), {
      scope: { kind: 'attribute', name: 'data-theme', value },
    })
    expect(css).toBe('')
    expect(codes(issues)).toEqual(['INVALID_VALUE'])
  })
})

describe('property: arbitrary font family strings never break out', () => {
  const anything = fc.string({ unit: 'binary', maxLength: 40 })
  const punctuationHeavy = fc.string({
    unit: fc.constantFrom(...'"\\<>{};/*!@ ab\u00e9\u65e5'.split('')),
    maxLength: 40,
  })

  it('either rejects the value with an issue or exports it safely', () => {
    fc.assert(
      fc.property(
        fc.oneof(anything, punctuationHeavy),
        fc.constantFrom(...SCOPES),
        (family, entry) => {
          const { css, issues } = toCssVariables([fontFamily('t.f', family)], {
            scope: entry.scope,
          })
          if (css === '') {
            expect(codes(issues)).toEqual(['INVALID_VALUE'])
            return
          }
          expect(issues).toEqual([])
          expect(scanCss(css)).toEqual([])
          expectCleanExport(css, {
            selector: entry.selector,
            names: ['--t-f'],
            grammar: { '--t-f': 'font-family' },
          })
        },
      ),
      { numRuns: 150 },
    )
  })
})

describe('the independent checkers can actually fail', () => {
  const clean =
    ':root {\n  --theme-font: "Arial", serif;\n  --theme-size: 4px;\n}\n'
  const options = {
    selector: ':root',
    names: ['--theme-font', '--theme-size'],
    grammar: { '--theme-font': 'font-family' },
  }

  it('accepts a good export (control case)', () => {
    expect(scanCss(clean)).toEqual([])
    expect(() => expectCleanExport(clean, options)).not.toThrow()
  })

  it('both flag a break-out written in the value of a custom property', () => {
    const broken =
      ':root {\n  --theme-font: "Arial"; } body { display:none } /*";\n  --theme-size: 4px;\n}\n'
    expect(scanCss(broken)).not.toEqual([])
    expect(() => expectCleanExport(broken, options)).toThrow()
    // What the parser actually saw: a second rule and a smuggled declaration.
    const parsed = parseCss(broken)
    expect(parsed.rules).toBe(2)
    expect(parsed.declarations.map((d) => d.name)).toEqual([
      '--theme-font',
      'display',
    ])
  })

  it('both flag a second declaration smuggled onto the same line', () => {
    const broken =
      ':root {\n  --theme-font: "Arial"; display: none;\n  --theme-size: 4px;\n}\n'
    expect(scanCss(broken)).not.toEqual([])
    expect(() => expectCleanExport(broken, options)).toThrow()
  })

  it('both flag a declaration closed early', () => {
    const broken =
      ':root {\n  --theme-font: "Arial"; }\n  --theme-size: 4px;\n}\n'
    expect(scanCss(broken)).not.toEqual([])
    expect(() => expectCleanExport(broken, options)).toThrow()
  })

  it('both flag an unterminated string and braces inside a value', () => {
    for (const value of ['"abc', 'a { b }']) {
      const broken = `:root {\n  --theme-font: ${value};\n  --theme-size: 4px;\n}\n`
      expect(scanCss(broken)).not.toEqual([])
      expect(() => expectCleanExport(broken, options)).toThrow()
    }
  })

  it('the parser flags a comment opened outside a string', () => {
    const broken =
      ':root {\n  --theme-font: "Arial" /* x */;\n  --theme-size: 4px;\n}\n'
    expect(scanCss(broken)).not.toEqual([])
    expect(() => expectCleanExport(broken, options)).toThrow()
  })

  it('the scanner flags the wrong selector and a missing closing brace', () => {
    expect(scanCss('body {\n  --a: 1;\n}\n')).not.toEqual([])
    expect(scanCss('[data-theme="Bad Slug"] {\n  --a: 1;\n}\n')).not.toEqual([])
    expect(scanCss(':root {\n  --a: 1;\n')).not.toEqual([])
    expect(scanCss(':root {\n--a: 1;\n}\n')).not.toEqual([])
  })

  it('the scanner accepts hostile-looking text that is safely inside a string', () => {
    expect(
      scanCss(':root {\n  --a: "} body { display:none } /*";\n}\n'),
    ).toEqual([])
  })

  it('without parseCustomProperty css-tree would not see inside --x values', () => {
    // This is why the oracle turns the option on: by default the value of a
    // custom property is kept as opaque text.
    const css = ':root {\n  --theme-font: "Arial"; display: none;\n}\n'
    let defaultValueType = ''
    csstree.walk(csstree.parse(css), (node) => {
      if (node.type === 'Declaration' && node.property === '--theme-font') {
        defaultValueType = node.value.type
      }
    })
    expect(defaultValueType).toBe('Raw')
    const parsed = parseCss(css)
    expect(parsed.declarations[0]?.valueType).toBe('Value')
  })

  it('LIMIT: the parser cannot see an HTML-level break-out; only the scanner can', () => {
    const htmlBreakout = ':root {\n  --theme-font: "</style><script>";\n}\n'
    expect(() =>
      expectCleanExport(htmlBreakout, {
        selector: ':root',
        names: ['--theme-font'],
        grammar: { '--theme-font': 'font-family' },
      }),
    ).not.toThrow()
    expect(scanCss(htmlBreakout)).toContain('contains "<"')
  })
})
