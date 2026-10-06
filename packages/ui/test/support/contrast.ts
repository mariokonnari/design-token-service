import { contrastRatio, type ResolvedToken, type Rgb } from '@dts/tokens-core'

export type PairKind = 'text' | 'non-text'

/** WCAG 2.x minimums: 4.5 for text, 3 for non-text UI parts. */
export const MIN_BY_KIND: Record<PairKind, number> = {
  text: 4.5,
  'non-text': 3,
}

export interface ContrastPair {
  /** The component the pair belongs to, as in `src/<Name>/` (or `Semantic` for shared roles). */
  component: string
  /** A short label for reports, unique within its component. */
  id: string
  kind: PairKind
  foreground: string
  /** The color the foreground really renders on: the surface it sits on, not a convenient token. */
  background: string
  min: number
}

export interface PairResult extends ContrastPair {
  ratio: number
  ok: boolean
}

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
  pairs: readonly ContrastPair[],
): PairResult[] {
  return pairs.map((pair) => {
    const ratio = contrastRatio(
      colorOf(resolved, pair.foreground),
      colorOf(resolved, pair.background),
    )
    return { ...pair, ratio, ok: ratio >= pair.min }
  })
}

/** Structural problems in a registry: duplicates, empty fields, or a minimum below its kind's. */
export function validateRegistry(pairs: readonly ContrastPair[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const pair of pairs) {
    const key = `${pair.component} / ${pair.id}`
    if (seen.has(key)) problems.push(`${key}: duplicate entry`)
    seen.add(key)
    if (pair.component === '' || pair.id === '') {
      problems.push(`${key}: component and id must not be empty`)
    }
    if (pair.foreground === '' || pair.background === '') {
      problems.push(`${key}: foreground and background must be named`)
    }
    const required = MIN_BY_KIND[pair.kind] as number | undefined
    if (required === undefined) {
      problems.push(`${key}: unknown kind "${String(pair.kind)}"`)
    } else if (pair.min < required) {
      problems.push(
        `${key}: min ${pair.min} is below the WCAG minimum ${required} for ${pair.kind}`,
      )
    }
  }
  return problems
}

/** The WCAG 2.2 target-size minimum, in CSS pixels. */
export const MIN_TARGET_PX = 24

/** Tokens that set a control's minimum size; each must be px and at least 24. */
export const MIN_SIZE_TOKENS = [
  'component.button.min-size-sm',
  'component.button.min-size-md',
  'component.textfield.min-size',
  'component.checkbox.min-size',
] as const

/** Minimum-size tokens that are missing, not px, or fall under the target-size minimum. */
export function minSizeProblems(
  resolved: readonly ResolvedToken[],
  paths: readonly string[] = MIN_SIZE_TOKENS,
): string[] {
  const problems: string[] = []
  for (const path of paths) {
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
