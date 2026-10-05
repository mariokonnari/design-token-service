/**
 * Names become CSS custom property names, so they are stricter than DTCG:
 * lowercase letters and digits in hyphen-separated groups (ADR 0006).
 */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/** Splits a dotted path into segments. The empty string is the root (no segments). */
export function splitPath(path: string): string[] {
  return path === '' ? [] : path.split('.')
}

export function joinPath(segments: readonly string[]): string {
  return segments.join('.')
}

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/

/** JS objects iterate "array index" keys (0 .. 2^32 - 2) first, in numeric order. */
function isArrayIndex(segment: string): boolean {
  return ARRAY_INDEX.test(segment) && Number(segment) < 4294967295
}

function compareSegments(a: string, b: string): number {
  const aIndex = isArrayIndex(a)
  const bIndex = isArrayIndex(b)
  if (aIndex && bIndex) return Number(a) - Number(b)
  if (aIndex) return -1
  if (bIndex) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Total order on dotted paths. Numeric segments (`100`, `500`, `1000`) sort
 * numerically and before other segments, which is exactly the order in which
 * JS iterates the keys of the nested object `nest()` builds.
 */
export function comparePaths(a: string, b: string): number {
  if (a === b) return 0
  const left = splitPath(a)
  const right = splitPath(b)
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i++) {
    const order = compareSegments(left[i] ?? '', right[i] ?? '')
    if (order !== 0) return order
  }
  return left.length - right.length
}

export type AliasParse =
  | { kind: 'not-alias' }
  | { kind: 'alias'; target: string }
  | { kind: 'malformed'; reason: string }

/**
 * Parses a DTCG curly-brace reference such as `{color.blue.500}`. A string that
 * starts with `{` and ends with `}` is always meant as a reference, so a bad
 * one is reported as malformed instead of being treated as a literal.
 */
export function parseAlias(raw: string): AliasParse {
  if (!raw.startsWith('{') || !raw.endsWith('}')) return { kind: 'not-alias' }
  const target = raw.slice(1, -1)
  if (target === '') {
    return { kind: 'malformed', reason: 'The reference is empty' }
  }
  const bad = splitPath(target).find((segment) => !isValidName(segment))
  if (bad !== undefined) {
    return {
      kind: 'malformed',
      reason: `"${bad}" is not a valid name segment (lowercase letters, digits and single hyphens only)`,
    }
  }
  return { kind: 'alias', target }
}
