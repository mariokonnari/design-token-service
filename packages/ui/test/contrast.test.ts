import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildThemes, loadThemeSources } from '../scripts/lib/buildThemes'
import { CONTRAST_PAIRS } from './contrastPairs'
import {
  MIN_BY_KIND,
  MIN_SIZE_TOKENS,
  MIN_TARGET_PX,
  evaluatePairs,
  minSizeProblems,
  validateRegistry,
  type ContrastPair,
} from './support/contrast'
import type { ResolvedToken } from '@dts/tokens-core'

// Contrast is computed from the tokens with tokens-core's WCAG 2.x
// `contrastRatio`, for every theme, from the declarative registry in
// test/contrastPairs.ts. jsdom cannot evaluate color-contrast from CSS, so this
// is where the guarantee lives (and, in a real browser, in the Storybook a11y
// addon). A failing pair means the TOKENS need fixing: never lower a threshold.
//
// What these tests CANNOT do: notice a text/background pair that nobody added
// to the registry. That is a manual step (checklist in CLAUDE.md).

const builds = buildThemes(loadThemeSources())

const color = (
  path: string,
  components: [number, number, number],
): ResolvedToken => ({
  path,
  type: 'color',
  value: { colorSpace: 'srgb', components },
})

describe('the registry itself', () => {
  it('is well formed: unique entries, named tokens, minimums not below the WCAG ones', () => {
    expect(validateRegistry(CONTRAST_PAIRS)).toEqual([])
  })

  it('uses the WCAG minimums: 4.5 for text and 3 for non-text', () => {
    expect(MIN_BY_KIND).toEqual({ text: 4.5, 'non-text': 3 })
    expect(MIN_TARGET_PX).toBe(24)
  })

  it('keeps every Button pair that existed before the registry', () => {
    const have = new Set(
      CONTRAST_PAIRS.map(
        (pair) => `${pair.foreground}|${pair.background}|${pair.min}`,
      ),
    )
    for (const expected of [
      'semantic.color.text|semantic.color.surface|4.5',
      'semantic.color.text-muted|semantic.color.surface|4.5',
      'semantic.color.action.on-primary|semantic.color.action.primary|4.5',
      'semantic.color.action.on-primary|semantic.color.action.primary-hover|4.5',
      'semantic.color.focus-ring|semantic.color.surface|3',
      'semantic.color.border|semantic.color.surface|3',
      'component.button.text-primary|component.button.bg-primary|4.5',
      'component.button.text-primary|component.button.bg-primary-hover|4.5',
      'component.button.text-secondary|component.button.bg-secondary|4.5',
      'component.button.text-secondary|component.button.bg-secondary-hover|4.5',
      'component.button.border-secondary|semantic.color.surface|3',
    ]) {
      expect(have.has(expected), expected).toBe(true)
    }
  })

  it('registers field labels, descriptions and errors against the page surface, not the input background', () => {
    const find = (id: string) =>
      CONTRAST_PAIRS.find(
        (pair) => pair.component === 'TextField' && pair.id === id,
      )
    for (const id of [
      'label on surface',
      'description on surface',
      'required hint on surface',
      'error text on surface',
    ]) {
      expect(find(id)?.background, id).toBe('semantic.color.surface')
    }
    expect(find('input text on input background')?.background).toBe(
      'component.textfield.bg',
    )
    expect(find('placeholder on input background')?.background).toBe(
      'component.textfield.bg',
    )
  })

  it('has entries for every component folder that ships CSS (a partial guard only)', () => {
    const src = join(import.meta.dirname, '..', 'src')
    const components = readdirSync(src, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) =>
        readdirSync(join(src, name)).some((file) => file.endsWith('.css')),
      )
    expect(components.length).toBeGreaterThan(0)
    const registered = new Set(CONTRAST_PAIRS.map((pair) => pair.component))
    for (const name of components) {
      expect(registered.has(name), `${name} has no contrast pairs`).toBe(true)
    }
  })
})

describe.each(builds)('contrast in the $slug theme', ({ slug, resolved }) => {
  it.each(
    CONTRAST_PAIRS.map(
      (pair) => [`${pair.component}: ${pair.id}`, pair] as const,
    ),
  )('%s', (_label, pair) => {
    const [result] = evaluatePairs(resolved, [pair])
    expect(
      result?.ratio,
      `${slug}: ${pair.component} ${pair.id} is ${result?.ratio.toFixed(2)}:1, needs ${pair.min}:1`,
    ).toBeGreaterThanOrEqual(pair.min)
  })

  it('keeps every control minimum size at or above 24px', () => {
    expect(minSizeProblems(resolved)).toEqual([])
    expect(MIN_SIZE_TOKENS.length).toBeGreaterThanOrEqual(6)
  })
})

describe('the registry can fail', () => {
  const white: [number, number, number] = [1, 1, 1]
  const bad: ContrastPair = {
    component: 'Fake',
    id: 'white on white',
    kind: 'text',
    foreground: 'fake.fg',
    background: 'fake.bg',
    min: 4.5,
  }

  it('reports a deliberately bad pair (white on white) as failing', () => {
    const [result] = evaluatePairs(
      [color('fake.fg', white), color('fake.bg', white)],
      [bad],
    )
    expect(result?.ratio).toBeCloseTo(1, 5)
    expect(result?.ok).toBe(false)
  })

  it('reports a borderline pair against its own threshold (#777777 on white is below 4.5)', () => {
    const grey = 0x77 / 255
    const [result] = evaluatePairs(
      [color('fake.fg', [grey, grey, grey]), color('fake.bg', white)],
      [bad],
    )
    expect(result?.ratio).toBeCloseTo(4.48, 1)
    expect(result?.ok).toBe(false)
  })

  it('throws a readable error for a token that does not exist', () => {
    expect(() => evaluatePairs([], [bad])).toThrow(/fake\.fg is not defined/)
  })

  it('rejects a registry entry whose minimum is below the WCAG minimum for its kind', () => {
    expect(validateRegistry([{ ...bad, min: 3 }])).toEqual([
      expect.stringContaining('below the WCAG minimum 4.5'),
    ])
    expect(
      validateRegistry([{ ...bad, kind: 'non-text', min: 2 }]),
    ).toHaveLength(1)
  })

  it('rejects duplicate and empty entries', () => {
    expect(validateRegistry([bad, bad])).toEqual([
      expect.stringContaining('duplicate'),
    ])
    expect(validateRegistry([{ ...bad, foreground: '' }])).toHaveLength(1)
  })

  it('flags a control size under 24px or in a relative unit', () => {
    const dim = (
      path: string,
      value: number,
      unit: 'px' | 'rem',
    ): ResolvedToken => ({
      path,
      type: 'dimension',
      value: { value, unit },
    })
    expect(
      minSizeProblems(
        [dim('a', 20, 'px'), dim('b', 2, 'rem'), dim('c', 24, 'px')],
        ['a', 'b', 'c', 'missing'],
      ),
    ).toHaveLength(3)
  })
})
