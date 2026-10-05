import { describe, expect, it } from 'vitest'
import { buildThemes, loadThemeSources } from '../scripts/lib/buildThemes'
import {
  BUTTON_PAIRS,
  MIN_TARGET_PX,
  SEMANTIC_PAIRS,
  evaluatePairs,
  minSizeProblems,
} from './support/contrast'
import type { ResolvedToken } from '@dts/tokens-core'

// Contrast is computed from the tokens with tokens-core's WCAG 2.x
// `contrastRatio`, for every theme. jsdom cannot evaluate color-contrast from
// CSS, so this is where the guarantee lives (and, in a real browser, in the
// Storybook a11y addon). A failing pair means the TOKENS need fixing: never
// lower a threshold here.

const builds = buildThemes(loadThemeSources())
const ALL_PAIRS = [...SEMANTIC_PAIRS, ...BUTTON_PAIRS]

function color(path: string, hex: [number, number, number]): ResolvedToken {
  return { path, type: 'color', value: { colorSpace: 'srgb', components: hex } }
}

describe('thresholds are the documented ones (guards against quietly lowering them)', () => {
  it('lists the required pairs with their WCAG minimums', () => {
    expect(
      ALL_PAIRS.map((pair) => [pair.foreground, pair.background, pair.min]),
    ).toEqual([
      ['semantic.color.text', 'semantic.color.surface', 4.5],
      ['semantic.color.text-muted', 'semantic.color.surface', 4.5],
      [
        'semantic.color.action.on-primary',
        'semantic.color.action.primary',
        4.5,
      ],
      [
        'semantic.color.action.on-primary',
        'semantic.color.action.primary-hover',
        4.5,
      ],
      ['semantic.color.focus-ring', 'semantic.color.surface', 3],
      ['semantic.color.border', 'semantic.color.surface', 3],
      ['semantic.color.danger', 'semantic.color.surface', 4.5],
      ['component.button.text-primary', 'component.button.bg-primary', 4.5],
      [
        'component.button.text-primary',
        'component.button.bg-primary-hover',
        4.5,
      ],
      ['component.button.text-secondary', 'component.button.bg-secondary', 4.5],
      [
        'component.button.text-secondary',
        'component.button.bg-secondary-hover',
        4.5,
      ],
      ['component.button.border-secondary', 'semantic.color.surface', 3],
    ])
    expect(MIN_TARGET_PX).toBe(24)
  })
})

describe.each(builds)('contrast in the $slug theme', ({ slug, resolved }) => {
  it.each(ALL_PAIRS.map((pair) => [pair.id, pair] as const))(
    '%s',
    (_id, pair) => {
      const [result] = evaluatePairs(resolved, [pair])
      expect(
        result?.ratio,
        `${slug}: ${pair.id} is ${result?.ratio.toFixed(2)}:1, needs ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min)
    },
  )

  it('keeps the button target sizes at or above 24px', () => {
    expect(minSizeProblems(resolved)).toEqual([])
  })
})

describe('the contrast checks can fail', () => {
  const white: [number, number, number] = [1, 1, 1]

  it('reports a pair that is too low (white on white)', () => {
    const [result] = evaluatePairs(
      [
        color('semantic.color.text', white),
        color('semantic.color.surface', white),
      ],
      [SEMANTIC_PAIRS[0]!],
    )
    expect(result?.ratio).toBeCloseTo(1, 5)
    expect(result?.ok).toBe(false)
  })

  it('reports a borderline pair against its own threshold (#777777 on white is below 4.5)', () => {
    const grey = 0x77 / 255
    const [result] = evaluatePairs(
      [
        color('semantic.color.text', [grey, grey, grey]),
        color('semantic.color.surface', white),
      ],
      [SEMANTIC_PAIRS[0]!],
    )
    expect(result?.ratio).toBeCloseTo(4.48, 1)
    expect(result?.ok).toBe(false)
  })

  it('throws a readable error for a missing token', () => {
    expect(() => evaluatePairs([], [SEMANTIC_PAIRS[0]!])).toThrow(
      /semantic\.color\.text is not defined/,
    )
  })

  it('flags a button size under 24px or in a relative unit', () => {
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
      minSizeProblems([
        dim('component.button.min-size-sm', 20, 'px'),
        dim('component.button.min-size-md', 2, 'rem'),
      ]),
    ).toHaveLength(2)
    expect(minSizeProblems([])).toHaveLength(2)
  })
})
