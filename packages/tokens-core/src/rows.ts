import { isValidName, parseAlias, splitPath } from './names'
import { TOKEN_TYPES } from './types'
import { cloneValue, validateLiteral } from './validate'
import type { AliasToken, Issue, LiteralToken, Token, TokenType } from './types'

/**
 * Token <-> "parts" (path, type, value, description): the shape a token has when it
 * is stored in a database row or sent over the API. PURE and DEFENSIVE: parts that
 * are not a valid token come back as `{ ok: false, message }`, never as a throw, so
 * a corrupt stored row cannot take a whole read down. Shared by the API (rows) and
 * the web editor (responses), so both read a token the same way.
 */

export interface TokenParts {
  path: string
  type: string | null
  value: unknown
  description: string | null
}

export type TokenFromParts =
  { ok: true; token: Token; warnings: Issue[] } | { ok: false; message: string }

const ALIAS_PATTERN = /^\{[^{}]+\}$/

function fail(message: string): TokenFromParts {
  return { ok: false, message }
}

function isTokenType(value: string): value is TokenType {
  return (TOKEN_TYPES as readonly string[]).includes(value)
}

function validPath(path: string): boolean {
  return path !== '' && splitPath(path).every(isValidName)
}

/** Parts to a token, or a message saying why they are not one. Never throws. */
export function tokenFromParts(parts: TokenParts): TokenFromParts {
  try {
    const { path } = parts
    if (typeof path !== 'string' || !validPath(path)) {
      return fail('The stored path is not a valid token path.')
    }
    if (parts.type !== null && !isTokenType(parts.type)) {
      return fail(`The stored type "${parts.type}" is not supported.`)
    }
    const description =
      typeof parts.description === 'string' ? parts.description : undefined

    const { value } = parts
    const looksLikeAlias =
      typeof value === 'string' && value.startsWith('{') && value.endsWith('}')
    if (looksLikeAlias) {
      const parsed = ALIAS_PATTERN.test(value) ? parseAlias(value) : undefined
      if (parsed?.kind !== 'alias')
        return fail('The stored alias is malformed.')
      const token: AliasToken = { path, alias: parsed.target }
      if (parts.type !== null) token.type = parts.type
      if (description !== undefined) token.description = description
      return { ok: true, token, warnings: [] }
    }

    if (parts.type === null) return fail('A stored literal has no type.')
    const result = validateLiteral(parts.type, value, path)
    if (!result.ok) {
      const first = result.issues[0]
      return fail(
        `The stored value is not a valid ${parts.type}${first === undefined ? '' : `: ${first.message}`}.`,
      )
    }
    const token = {
      path,
      type: parts.type,
      value: result.value,
    } as LiteralToken
    if (description !== undefined) token.description = description
    return { ok: true, token, warnings: result.issues }
  } catch {
    // Defensive: a pathological value must not take a whole read down.
    return fail('The stored row could not be read.')
  }
}

/** A validated token to its parts. Shares no objects with the token (the value is copied). */
export function tokenToParts(token: Token): TokenParts {
  const description = token.description ?? null
  if ('alias' in token) {
    return {
      path: token.path,
      type: token.type ?? null,
      value: `{${token.alias}}`,
      description,
    }
  }
  return {
    path: token.path,
    type: token.type,
    value: cloneValue(token.value),
    description,
  }
}
