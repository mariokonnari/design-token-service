import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import * as csstree from 'css-tree'
import { describe, expect, it } from 'vitest'
import {
  declaredVariables,
  findPrimitiveReferences,
  findRawColors,
  findUndefinedVariables,
  findVarFallbacks,
  findVarReferences,
} from './support/cssRules'

// The same styling rules as packages/ui (ADR 0008), applied to the web app's own
// CSS: only semantic and component variables, no raw colors, no primitives, no
// var() fallbacks, and every variable defined in every theme. Plus the link rules.

const SRC = join(import.meta.dirname, '..', 'src')
const require = createRequire(import.meta.url)
const themes = declaredVariables(
  readFileSync(require.resolve('@dts/ui/themes.css'), 'utf8'),
)

const stylesheets = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'))
  .sort()
  .map((file) => ({ file, css: readFileSync(join(SRC, file), 'utf8') }))

/** The link rules (WCAG 1.4.1 use of color, 2.4.7 focus visible), see LINK_RULES below. */
function findLinkProblems(css: string): string[] {
  const problems: string[] = []
  let underlined = false
  let focusOutline = false
  let forcedColors = false
  const ast = csstree.parse(css, { parseCustomProperty: true })
  csstree.walk(ast, {
    visit: 'Rule',
    enter(rule) {
      const selector = csstree.generate(rule.prelude)
      const isLink = /(^|[\s,])\.link(?![\w-])/.test(selector)
      if (!isLink) return
      csstree.walk(rule.block, {
        visit: 'Declaration',
        enter(declaration) {
          const value = csstree.generate(declaration.value).toLowerCase()
          if (
            selector.includes(':focus-visible') &&
            declaration.property === 'outline' &&
            !/^(none|0)(\s|$)/.test(value)
          ) {
            focusOutline = true
          }
          if (
            !selector.includes(':') &&
            (declaration.property === 'text-decoration' ||
              declaration.property === 'text-decoration-line') &&
            value.includes('underline')
          ) {
            underlined = true
          }
          if (
            declaration.property.startsWith('outline') &&
            /^(none|0)(\s|$)/.test(value)
          ) {
            problems.push(`${selector}: removes the outline`)
          }
        },
      })
    },
  })
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(atrule) {
      if (
        atrule.name === 'media' &&
        atrule.prelude !== null &&
        csstree
          .generate(atrule.prelude)
          .replaceAll(/\s+/g, '')
          .includes('(forced-colors:active)') &&
        csstree.generate(atrule.block ?? atrule).includes('.link')
      ) {
        forcedColors = true
      }
    },
  })
  if (!underlined) problems.push('.link is not underlined')
  if (!focusOutline) problems.push('.link:focus-visible draws no outline')
  if (!forcedColors) problems.push('no forced-colors rule for .link')
  return problems
}

describe('web stylesheet inventory (so the rules below are not vacuous)', () => {
  it('finds the app stylesheet and it really uses semantic variables', () => {
    const app = stylesheets.find((s) => s.file.endsWith('app.css'))
    expect(app, 'src/styles/app.css').toBeDefined()
    expect(findVarReferences(app?.css ?? '').length).toBeGreaterThan(10)
  })

  it('reads both themes from @dts/ui/themes.css', () => {
    expect([...themes.keys()].sort()).toEqual(['acme', 'default'])
    expect(themes.get('default')?.size).toBeGreaterThan(30)
  })
})

describe.each(stylesheets)('rules for $file', ({ css }) => {
  it('(a1) never mentions a primitive variable', () => {
    expect(findPrimitiveReferences(css)).toEqual([])
  })

  it('(a2) contains no raw color values (hex, color functions, named colors)', () => {
    expect(findRawColors(css)).toEqual([])
  })

  it('(a3) uses no var() fallback values', () => {
    expect(findVarFallbacks(css)).toEqual([])
  })

  it('(b) reads only variables that are defined in every theme', () => {
    expect(findUndefinedVariables(css, themes)).toEqual([])
  })

  it('reads only semantic and component variables', () => {
    for (const name of findVarReferences(css)) {
      expect(name).toMatch(/^--(?:semantic|component)-/)
    }
  })
})

describe('in-text links', () => {
  it('(links) are underlined, keep a focus outline and survive forced colors', () => {
    const all = stylesheets.map((s) => s.css).join('\n')
    expect(findLinkProblems(all)).toEqual([])
  })
})

// --- the scanners can fail -------------------------------------------------

describe('scanner self-tests: the copied rules still bite', () => {
  it('findPrimitiveReferences flags a primitive in a value or a comment', () => {
    expect(
      findPrimitiveReferences(
        '.a { color: var(--primitive-color-brand-500); }',
      ),
    ).toEqual(['--primitive-color-brand-500'])
    expect(findPrimitiveReferences('/* --primitive-space-4 */')).toEqual([
      '--primitive-space-4',
    ])
    expect(
      findPrimitiveReferences('.a { color: var(--semantic-color-text); }'),
    ).toEqual([])
  })

  it.each([
    ['a 3-digit hex', '.a { color: #fff; }', ['#fff']],
    ['a 6-digit hex', '.a { color: #ffffff; }', ['#ffffff']],
    ['rgb()', '.a { color: rgb(0 0 0); }', ['rgb()']],
    ['hsl()', '.a { color: hsl(10 20% 30%); }', ['hsl()']],
    ['oklch()', '.a { color: oklch(0.5 0.1 200); }', ['oklch()']],
    [
      'color-mix()',
      '.a { color: color-mix(in srgb, red, blue); }',
      ['color-mix()', 'red', 'blue'],
    ],
    ['a named color', '.a { color: red; }', ['red']],
    [
      'a border shorthand with a named color',
      '.a { border: 1px solid white; }',
      ['white'],
    ],
    ['a color in a custom property', '.a { --x: #123456; }', ['#123456']],
  ])('findRawColors flags %s', (_label, css, expected) => {
    expect(findRawColors(css)).toEqual(expected)
  })

  it('findRawColors allows transparent, currentColor, inherit, system colors and font names', () => {
    expect(
      findRawColors(
        '.a { background: transparent; color: currentColor; border-color: inherit; outline-color: Highlight; background: Canvas; font-family: orange, sans-serif; }',
      ),
    ).toEqual([])
  })

  it.each([
    ['a fallback value', '.a { margin: var(--x, 4px); }'],
    ['an empty fallback', '.a { margin: var(--x,); }'],
    ['a nested fallback', '.a { margin: var(--x, var(--y)); }'],
  ])('findVarFallbacks flags %s', (_label, css) => {
    expect(findVarFallbacks(css)).toHaveLength(1)
  })

  it('findVarFallbacks accepts var() without a fallback', () => {
    expect(
      findVarFallbacks(
        '.a { margin: var(--x); padding: calc(var(--x) + 1px); }',
      ),
    ).toEqual([])
  })

  it('findUndefinedVariables reports a variable that a theme lacks', () => {
    const sample = declaredVariables(`
      [data-theme="one"] { --semantic-a: 1; --semantic-b: 2; }
      [data-theme="two"] { --semantic-a: 1; }
    `)
    expect(
      findUndefinedVariables('.x { color: var(--semantic-b); }', sample),
    ).toEqual([{ theme: 'two', variable: '--semantic-b' }])
    expect(
      findUndefinedVariables('.x { color: var(--semantic-nope); }', sample),
    ).toHaveLength(2)
    expect(
      findUndefinedVariables('.x { color: var(--semantic-a); }', sample),
    ).toEqual([])
  })
})

describe('scanner self-tests: findLinkProblems', () => {
  const GOOD = `
    .link { color: var(--semantic-color-text); text-decoration: underline; }
    .link:focus-visible { outline: var(--semantic-border-width-focus) solid var(--semantic-color-focus-ring); outline-offset: 2px; }
    @media (forced-colors: active) { .link { color: LinkText; } }
  `

  it('accepts a complete link style', () => {
    expect(findLinkProblems(GOOD)).toEqual([])
  })

  it('flags a link that is not underlined (color alone)', () => {
    expect(
      findLinkProblems(
        GOOD.replace('text-decoration: underline', 'text-decoration: none'),
      ),
    ).toContain('.link is not underlined')
  })

  it('flags a link with no focus outline', () => {
    expect(
      findLinkProblems(GOOD.replace(/\.link:focus-visible \{[^}]*\}/, '')),
    ).toContain('.link:focus-visible draws no outline')
  })

  it('flags an outline that is removed', () => {
    const problems = findLinkProblems(
      GOOD.replace(
        'outline: var(--semantic-border-width-focus) solid var(--semantic-color-focus-ring)',
        'outline: none',
      ),
    )
    expect(problems).toContain('.link:focus-visible: removes the outline')
    expect(problems).toContain('.link:focus-visible draws no outline')
  })

  it('flags a missing forced-colors rule', () => {
    expect(findLinkProblems(GOOD.replace(/@media[\s\S]*$/, ''))).toContain(
      'no forced-colors rule for .link',
    )
  })
})
