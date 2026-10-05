import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENERATED_CSS_PATH } from '../scripts/lib/buildThemes'
import {
  declaredVariables,
  findPrimitiveReferences,
  findRawColors,
  findUndefinedVariables,
  findVarFallbacks,
  findVarReferences,
} from './support/cssRules'

const SRC = join(import.meta.dirname, '..', 'src')
const themesCss = readFileSync(GENERATED_CSS_PATH, 'utf8')
const themes = declaredVariables(themesCss)

/** Every component stylesheet: all CSS under src except the generated theme file. */
const componentCss = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css') && !file.endsWith('.generated.css'))
  .sort()
  .map((file) => ({ file, css: readFileSync(join(SRC, file), 'utf8') }))

describe('component CSS inventory', () => {
  it('finds the component stylesheets (so the rules below are not vacuous)', () => {
    expect(componentCss.map((entry) => entry.file)).toContain(
      join('Button', 'Button.css'),
    )
    const button = componentCss.find((entry) =>
      entry.file.endsWith('Button.css'),
    )
    expect(findVarReferences(button?.css ?? '').length).toBeGreaterThan(10)
  })

  it('reads both themes from the generated CSS', () => {
    expect([...themes.keys()].sort()).toEqual(['acme', 'default'])
    expect(themes.get('default')?.size).toBeGreaterThan(30)
  })
})

describe.each(componentCss)('rules for $file', ({ css }) => {
  it('(a1) never mentions a primitive variable', () => {
    expect(findPrimitiveReferences(css)).toEqual([])
  })

  it('(a2) contains no raw color values (hex, color functions, named colors)', () => {
    expect(findRawColors(css)).toEqual([])
  })

  it('(a3) uses no var() fallback values', () => {
    expect(findVarFallbacks(css)).toEqual([])
  })

  it('(b) reads only variables that are defined in every generated theme', () => {
    expect(findUndefinedVariables(css, themes)).toEqual([])
  })

  it('reads only semantic and component variables', () => {
    for (const name of findVarReferences(css)) {
      expect(name).toMatch(/^--(?:semantic|component)-/)
    }
  })
})

// --- the scanners can fail -------------------------------------------------

describe('scanner self-tests: findPrimitiveReferences', () => {
  it('flags a primitive variable in a value or a comment', () => {
    expect(
      findPrimitiveReferences(
        '.a { color: var(--primitive-color-brand-500); }',
      ),
    ).toEqual(['--primitive-color-brand-500'])
    expect(findPrimitiveReferences('/* uses --primitive-space-4 */')).toEqual([
      '--primitive-space-4',
    ])
  })

  it('accepts semantic and component variables', () => {
    expect(
      findPrimitiveReferences(
        '.a { color: var(--semantic-color-text); margin: var(--component-button-gap); }',
      ),
    ).toEqual([])
  })
})

describe('scanner self-tests: findRawColors', () => {
  it.each([
    ['a 3-digit hex', '.a { color: #fff; }', ['#fff']],
    ['a 6-digit hex', '.a { color: #ffffff; }', ['#ffffff']],
    ['a 4-digit hex', '.a { color: #ffff; }', ['#ffff']],
    ['an 8-digit hex', '.a { color: #ffffffff; }', ['#ffffffff']],
    ['rgb()', '.a { color: rgb(0 0 0); }', ['rgb()']],
    ['rgba()', '.a { color: rgba(0, 0, 0, 0.5); }', ['rgba()']],
    ['hsl()', '.a { color: hsl(10 20% 30%); }', ['hsl()']],
    ['hsla()', '.a { color: hsla(10, 20%, 30%, 0.5); }', ['hsla()']],
    ['hwb()', '.a { color: hwb(10 20% 30%); }', ['hwb()']],
    ['oklch()', '.a { color: oklch(0.5 0.1 200); }', ['oklch()']],
    ['color()', '.a { color: color(srgb 1 0 0); }', ['color()']],
    ['the named color red', '.a { color: red; }', ['red']],
    ['the named color white', '.a { background: white; }', ['white']],
    ['rebeccapurple', '.a { border-color: rebeccapurple; }', ['rebeccapurple']],
    [
      'a gradient that contains named colors',
      '.a { background-image: linear-gradient(to right, white, black); }',
      ['white', 'black'],
    ],
    [
      'a color inside a custom property declaration',
      '.a { --x: #123456; }',
      ['#123456'],
    ],
  ])('flags %s', (_label, css, expected) => {
    expect(findRawColors(css)).toEqual(expected)
  })

  it('flags every offender in a mixed sample', () => {
    expect(
      findRawColors(
        '.a { color: red; background: #fff; border-color: rgb(0 0 0); }',
      ),
    ).toEqual(['red', '#fff', 'rgb()'])
  })

  it('explicitly allows transparent, inherit and currentColor', () => {
    expect(
      findRawColors(
        '.a { background: transparent; color: currentColor; border-color: inherit; fill: CURRENTCOLOR; }',
      ),
    ).toEqual([])
  })

  it('allows system colors, which forced-colors rules need', () => {
    expect(
      findRawColors(
        '.a { border-color: ButtonText; color: GrayText; outline-color: Highlight; background: Canvas; }',
      ),
    ).toEqual([])
  })

  it('does not treat selectors, media queries, font names or non-color hashes as colors', () => {
    expect(
      findRawColors(`
        .a[data-variant=red] { font-family: orange, sans-serif; }
        @media (forced-colors: active) { .b { border-style: solid; } }
        .c { background-image: url(#fragment); color: var(--semantic-color-text); }
      `),
    ).toEqual([])
  })
})

describe('scanner self-tests: findVarFallbacks', () => {
  it.each([
    ['a fallback value', '.a { margin: var(--x, 4px); }'],
    ['an empty fallback', '.a { margin: var(--x,); }'],
    ['a nested var() fallback', '.a { margin: var(--x, var(--y)); }'],
    ['a calc() fallback', '.a { width: var( --x , calc(1px + 2px) ); }'],
  ])('flags %s', (_label, css) => {
    expect(findVarFallbacks(css)).toHaveLength(1)
  })

  it('accepts var() without a fallback, including nested use', () => {
    expect(
      findVarFallbacks(
        '.a { margin: var(--x); padding: calc(var(--x) + var(--y)); }',
      ),
    ).toEqual([])
  })
})

describe('scanner self-tests: variable definitions', () => {
  const sample = `
    [data-theme="one"] { --semantic-a: 1; --semantic-b: 2; }
    [data-theme="two"] { --semantic-a: 1; }
  `
  const declared = declaredVariables(sample)

  it('reads declarations per theme', () => {
    expect([...(declared.get('one') ?? [])]).toEqual([
      '--semantic-a',
      '--semantic-b',
    ])
    expect([...(declared.get('two') ?? [])]).toEqual(['--semantic-a'])
  })

  it('reports a variable that does not exist in any theme', () => {
    expect(
      findUndefinedVariables('.x { color: var(--semantic-nope); }', declared),
    ).toEqual([
      { theme: 'one', variable: '--semantic-nope' },
      { theme: 'two', variable: '--semantic-nope' },
    ])
  })

  it('reports a variable that only some themes define', () => {
    expect(
      findUndefinedVariables('.x { color: var(--semantic-b); }', declared),
    ).toEqual([{ theme: 'two', variable: '--semantic-b' }])
  })

  it('reports nothing when every theme defines every variable used', () => {
    expect(
      findUndefinedVariables('.x { color: var(--semantic-a); }', declared),
    ).toEqual([])
  })
})
