import { isValidName, splitPath } from '@dts/tokens-core'
import { LIMITS, RESERVED_NAMES } from './limits'

/**
 * The selected token lives in the URL as `?token=<path>` (deep links from the
 * validation list, reload, tests). The value is attacker-controlled, so it is NEVER
 * trusted: only a plain token path passes. Everything else (`__proto__`,
 * `constructor`, a 10 KB string, control characters, slashes, encoded slashes,
 * markup) is "invalid", which the page shows as a calm "token not found". The
 * value is only ever compared as text (a Map lookup), never used as an object key,
 * never put in a URL or markup without encoding.
 */
export type TokenParam =
  { kind: 'none' } | { kind: 'path'; path: string } | { kind: 'invalid' }

export function parseTokenParam(raw: string | null): TokenParam {
  if (raw === null || raw === '') return { kind: 'none' }
  // The length check comes first: no pattern ever looks at a huge string.
  if (raw.length > LIMITS.maxPathLength) return { kind: 'invalid' }
  const segments = splitPath(raw)
  if (
    !segments.every(isValidName) ||
    segments.some((segment) => RESERVED_NAMES.has(segment))
  ) {
    return { kind: 'invalid' }
  }
  return { kind: 'path', path: raw }
}
