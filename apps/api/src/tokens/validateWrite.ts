import {
  flatten,
  isValidName,
  splitPath,
  type Issue,
  type Token,
  type TokenTree,
} from '@dts/tokens-core'

import { RESERVED_NAMES } from './treeGuard'

/**
 * The API's own limits on top of the tokens-core rules (ADR 0014). Every write path
 * (PUT and import) applies the same ones, through validateSingleToken.
 */
export const LIMITS = {
  /** The DB CHECK only constrains the shape of a path, not its length. */
  MAX_PATH_LENGTH: 200,
  /** Bytes of the JSON-encoded value. */
  MAX_VALUE_BYTES: 8192,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_TOKENS_PER_BRAND: 2000,
} as const

export interface SingleTokenInput {
  path: string
  type?: unknown
  value: unknown
  description?: unknown
}

export type SingleTokenResult =
  { ok: true; token: Token; warnings: Issue[] } | { ok: false; issues: Issue[] }

function problem(
  path: string,
  field: string,
  message: string,
  code: Issue['code'] = 'INVALID_VALUE',
): Issue {
  return { code, severity: 'error', path, message, field }
}

/**
 * Validates ONE token by handing a one-token tree to tokens-core's `flatten`, so the
 * rules (types, literal shapes, alias syntax, MISSING_TYPE) live in exactly one
 * place. Only the limits above are checked here. Never throws.
 *
 * Tier rules and alias targets are NOT checked: a draft may be invalid and
 * validation is a separate step (ADR 0012, /validate).
 */
export function validateSingleToken(
  input: SingleTokenInput,
): SingleTokenResult {
  const { path } = input
  const early: Issue[] = []

  const segments = splitPath(path)
  const reserved = segments.find((segment) => RESERVED_NAMES.has(segment))
  if (reserved !== undefined) {
    early.push(
      problem(
        path,
        'path',
        `"${reserved}" is a reserved name and cannot be used in a path.`,
        'INVALID_NAME',
      ),
    )
  } else if (path === '' || !segments.every(isValidName)) {
    early.push(
      problem(
        path,
        'path',
        'A path is dot-separated names of lowercase letters, digits and single hyphens.',
        'INVALID_NAME',
      ),
    )
  } else if (path.length > LIMITS.MAX_PATH_LENGTH) {
    early.push(
      problem(
        path,
        'path',
        `A path may be at most ${LIMITS.MAX_PATH_LENGTH} characters.`,
        'INVALID_NAME',
      ),
    )
  }

  if (input.value === undefined) {
    early.push(problem(path, 'value', 'A value is required.'))
  } else {
    const encoded = JSON.stringify(input.value) ?? ''
    if (Buffer.byteLength(encoded, 'utf8') > LIMITS.MAX_VALUE_BYTES) {
      early.push(
        problem(
          path,
          'value',
          `The value may be at most ${LIMITS.MAX_VALUE_BYTES} bytes of JSON.`,
        ),
      )
    }
  }

  if (
    typeof input.description === 'string' &&
    input.description.length > LIMITS.MAX_DESCRIPTION_LENGTH
  ) {
    early.push(
      problem(
        path,
        'description',
        `A description may be at most ${LIMITS.MAX_DESCRIPTION_LENGTH} characters.`,
        'INVALID_STRUCTURE',
      ),
    )
  }

  // The path is checked above, so no segment can be `__proto__` or empty.
  if (early.length > 0) return { ok: false, issues: early }

  const node: Record<string, unknown> = { $value: input.value }
  if (input.type !== undefined) node['$type'] = input.type
  if (input.description !== undefined) node['$description'] = input.description

  let cursor: TokenTree = node
  for (const segment of [...segments].reverse()) {
    cursor = { [segment]: cursor }
  }

  const flat = flatten(cursor)
  const [token] = flat.tokens
  if (
    flat.issues.some((issue) => issue.severity === 'error') ||
    token === undefined ||
    flat.tokens.length !== 1
  ) {
    return {
      ok: false,
      issues:
        flat.issues.length > 0
          ? flat.issues
          : [problem(path, 'value', 'The token is not valid.')],
    }
  }
  return { ok: true, token, warnings: flat.issues }
}
