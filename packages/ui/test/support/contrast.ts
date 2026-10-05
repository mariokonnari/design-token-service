import { contrastRatio, type ResolvedToken, type Rgb } from '@dts/tokens-core'

export interface Pair {
  /** A short label for reports. */
  id: string
  foreground: string
  background: string
  /** WCAG 2.x minimum: 4.5 for text, 3 for non-text UI parts and large text. */
  min: number
}

export interface PairResult extends Pair {
  ratio: number
  ok: boolean
}

const TEXT = 4.5
const NON_TEXT = 3

/** Pairs the design system relies on, from the semantic tokens. */
export const SEMANTIC_PAIRS: readonly Pair[] = [
  {
    id: 'text on surface',
    foreground: 'semantic.color.text',
    background: 'semantic.color.surface',
    min: TEXT,
  },
  {
    id: 'text-muted on surface',
    foreground: 'semantic.color.text-muted',
    background: 'semantic.color.surface',
    min: TEXT,
  },
  {
    id: 'on-primary on action-primary',
    foreground: 'semantic.color.action.on-primary',
    background: 'semantic.color.action.primary',
    min: TEXT,
  },
  {
    id: 'on-primary on action-primary-hover',
    foreground: 'semantic.color.action.on-primary',
    background: 'semantic.color.action.primary-hover',
    min: TEXT,
  },
  {
    id: 'focus-ring on surface',
    foreground: 'semantic.color.focus-ring',
    background: 'semantic.color.surface',
    min: NON_TEXT,
  },
  {
    id: 'border on surface',
    foreground: 'semantic.color.border',
    background: 'semantic.color.surface',
    min: NON_TEXT,
  },
  {
    id: 'danger on surface',
    foreground: 'semantic.color.danger',
    background: 'semantic.color.surface',
    min: TEXT,
  },
]

/** Every text/background pair the Button actually uses, from the component.button tokens. */
export const BUTTON_PAIRS: readonly Pair[] = [
  {
    id: 'button text-primary on bg-primary',
    foreground: 'component.button.text-primary',
    background: 'component.button.bg-primary',
    min: TEXT,
  },
  {
    id: 'button text-primary on bg-primary-hover',
    foreground: 'component.button.text-primary',
    background: 'component.button.bg-primary-hover',
    min: TEXT,
  },
  {
    id: 'button text-secondary on bg-secondary',
    foreground: 'component.button.text-secondary',
    background: 'component.button.bg-secondary',
    min: TEXT,
  },
  {
    id: 'button text-secondary on bg-secondary-hover',
    foreground: 'component.button.text-secondary',
    background: 'component.button.bg-secondary-hover',
    min: TEXT,
  },
  {
    id: 'button border-secondary on the surface',
    foreground: 'component.button.border-secondary',
    background: 'semantic.color.surface',
    min: NON_TEXT,
  },
]

function colorOf(resolved: readonly ResolvedToken[], path: string): Rgb {
  const token = resolved.find((candidate) => candidate.path === path)
  if (token === undefined) throw new Error(`token ${path} is not defined`)
  if (token.type !== 'color') throw new Error(`token ${path} is not a color`)
  if (token.value.alpha !== undefined && token.value.alpha !== 1) {
    throw new Error(
      `token ${path} is translucent; contrast needs an opaque color`,
    )
  }
  return [...token.value.components]
}

export function evaluatePairs(
  resolved: readonly ResolvedToken[],
  pairs: readonly Pair[],
): PairResult[] {
  return pairs.map((pair) => {
    const ratio = contrastRatio(
      colorOf(resolved, pair.foreground),
      colorOf(resolved, pair.background),
    )
    return { ...pair, ratio, ok: ratio >= pair.min }
  })
}

/** The WCAG 2.2 target-size minimum, in CSS pixels. */
export const MIN_TARGET_PX = 24

/** Button minimum sizes that are not px or fall under the target-size minimum. */
export function minSizeProblems(resolved: readonly ResolvedToken[]): string[] {
  const problems: string[] = []
  for (const size of ['sm', 'md']) {
    const path = `component.button.min-size-${size}`
    const token = resolved.find((candidate) => candidate.path === path)
    if (token?.type !== 'dimension') {
      problems.push(`${path} is missing or not a dimension`)
    } else if (token.value.unit !== 'px' || token.value.value < MIN_TARGET_PX) {
      problems.push(
        `${path} is ${token.value.value}${token.value.unit}, needs at least ${MIN_TARGET_PX}px`,
      )
    }
  }
  return problems
}
