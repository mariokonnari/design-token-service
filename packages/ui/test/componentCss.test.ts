import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findFocusVisibleProblems,
  forcedColorsProperties,
  transitionWithoutReducedMotion,
} from './support/cssRules'

// Structural checks on the component stylesheets. Forced-colors, focus and
// reduced-motion behaviour are verified here as CSS TEXT only: nobody has
// rendered them in a browser in this test suite (see ADR 0008 and 0009).

const SRC = join(import.meta.dirname, '..', 'src')

/** Component stylesheets: everything except the generated themes and the shared utility. */
const componentCss = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter(
    (file) =>
      file.endsWith('.css') &&
      !file.endsWith('.generated.css') &&
      !file.endsWith('visually-hidden.css'),
  )
  .sort()
  .map((file) => ({ file, css: readFileSync(join(SRC, file), 'utf8') }))

describe('component stylesheets', () => {
  it('include every component', () => {
    expect(
      componentCss.map((entry) => entry.file.replaceAll('\\', '/')),
    ).toEqual([
      'Alert/Alert.css',
      'Button/Button.css',
      'Checkbox/Checkbox.css',
      'TextField/TextField.css',
    ])
  })
})

describe.each(componentCss)('$file', ({ css }) => {
  it('has a forced-colors rule with at least one declaration', () => {
    expect(forcedColorsProperties(css).length).toBeGreaterThan(0)
  })

  it('draws every :focus-visible ring with outline and never box-shadow', () => {
    expect(findFocusVisibleProblems(css)).toEqual([])
  })

  it('switches transitions off for prefers-reduced-motion', () => {
    expect(transitionWithoutReducedMotion(css)).toBe(false)
  })
})

describe('forced-colors keeps borders visible where background colors are dropped', () => {
  const byName = (name: string) =>
    componentCss.find((entry) => entry.file.replaceAll('\\', '/') === name)
      ?.css ?? ''

  it.each(['TextField/TextField.css', 'Alert/Alert.css', 'Button/Button.css'])(
    '%s sets a border color with a system color keyword',
    (name) => {
      const properties = forcedColorsProperties(byName(name))
      expect(
        properties.some((property) => property.startsWith('border')),
        `${name}: ${properties.join(', ')}`,
      ).toBe(true)
    },
  )

  it('Checkbox keeps its mark and focus ring in forced colors', () => {
    const properties = forcedColorsProperties(byName('Checkbox/Checkbox.css'))
    expect(properties).toContain('accent-color')
    expect(properties).toContain('outline-color')
  })
})

describe('structural scanners can fail', () => {
  it('forcedColorsProperties is empty without a forced-colors block and sees nested declarations', () => {
    expect(forcedColorsProperties('.a { color: red; }')).toEqual([])
    expect(
      forcedColorsProperties(
        '@media (forced-colors: active) { .a { border-color: ButtonText; } .b { color: GrayText; } }',
      ),
    ).toEqual(['border-color', 'color'])
    expect(
      forcedColorsProperties(
        '@media (prefers-reduced-motion: reduce) { .a { transition: none; } }',
      ),
    ).toEqual([])
  })

  it('findFocusVisibleProblems flags box-shadow and a missing outline', () => {
    expect(
      findFocusVisibleProblems(
        '.a:focus-visible { box-shadow: 0 0 0 2px var(--semantic-color-focus-ring); }',
      ),
    ).toEqual([
      '.a:focus-visible: box-shadow',
      'no :focus-visible rule draws an outline',
    ])
    expect(
      findFocusVisibleProblems(
        '.a:focus-visible { outline: 2px solid currentColor; }',
      ),
    ).toEqual([])
    // A rule that only adjusts outline-color is fine when another rule draws it.
    expect(
      findFocusVisibleProblems(
        '.a:focus-visible { outline: 2px solid currentColor; } @media (forced-colors: active) { .a:focus-visible { outline-color: Highlight; } }',
      ),
    ).toEqual([])
    expect(
      findFocusVisibleProblems(
        '.a:focus-visible { outline-color: Highlight; }',
      ),
    ).toEqual(['no :focus-visible rule draws an outline'])
    // No :focus-visible rule at all (a non-interactive component) is not a problem.
    expect(findFocusVisibleProblems('.a:hover { color: inherit; }')).toEqual([])
  })

  it('transitionWithoutReducedMotion flags a transition that is never switched off', () => {
    expect(
      transitionWithoutReducedMotion('.a { transition: color 100ms; }'),
    ).toBe(true)
    expect(
      transitionWithoutReducedMotion(
        '.a { transition: color 100ms; } @media (prefers-reduced-motion: reduce) { .a { transition: none; } }',
      ),
    ).toBe(false)
    expect(transitionWithoutReducedMotion('.a { color: inherit; }')).toBe(false)
  })
})
