import {
  TOKEN_TYPES,
  parseAlias,
  splitPath,
  isValidName,
  validateLiteral,
  type AliasToken,
  type Issue,
  type IssueCode,
  type LiteralToken,
  type Token,
  type TokenType,
} from '@dts/tokens-core'

/**
 * DB row <-> tokens-core Token. PURE: no Prisma, no I/O (the lint rule keeps the
 * generated client inside src/db and src/repositories, and the mapper is tested
 * without a database).
 *
 * The draft may be invalid (ADR 0012), but a STORED row can also be corrupt (a raw
 * SQL edit, an old bug). The mapper never throws on one: it returns an
 * UNMAPPABLE_ROW issue so a reader can report it and a user can delete the row.
 */

/**
 * tokens-core issue codes plus the codes that only exist at this boundary:
 * UNMAPPABLE_ROW (a stored row that is not a valid token), EMPTY_DRAFT (nothing to
 * publish) and RULE_FAILED (a validation rule crashed; see validateDraft).
 */
export type DraftIssueCode =
  | IssueCode
  | 'UNMAPPABLE_ROW'
  | 'EMPTY_DRAFT'
  | 'RULE_FAILED'
  | 'NOTHING_TO_EXPORT'
  | 'RELEASE_TOO_LARGE'

export type DraftIssue = Omit<Issue, 'code'> & { code: DraftIssueCode }

/** What the mapper needs from a Token row (a structural subset of the Prisma model). */
export interface TokenRowInput {
  path: string
  type: string | null
  value: unknown
  description: string | null
  version?: number
}

/** What is written to a Token row (the rest is the repository's business). */
export interface TokenRowData {
  path: string
  type: string | null
  value: unknown
  description: string | null
}

export type MapResult =
  | { ok: true; token: Token; warnings: Issue[] }
  | { ok: false; issue: DraftIssue }

const ALIAS_PATTERN = /^\{[^{}]+\}$/

function unmappable(path: string, message: string): MapResult {
  return {
    ok: false,
    issue: { code: 'UNMAPPABLE_ROW', severity: 'error', path, message },
  }
}

function isTokenType(value: string): value is TokenType {
  return (TOKEN_TYPES as readonly string[]).includes(value)
}

function validPath(path: string): boolean {
  return path !== '' && splitPath(path).every(isValidName)
}

/** A stored row to a token, or an UNMAPPABLE_ROW issue. Never throws. */
export function rowToToken(row: TokenRowInput): MapResult {
  try {
    const { path } = row
    if (typeof path !== 'string' || !validPath(path)) {
      return unmappable(
        String(path),
        'The stored path is not a valid token path.',
      )
    }
    if (row.type !== null && !isTokenType(row.type)) {
      return unmappable(path, `The stored type "${row.type}" is not supported.`)
    }
    const description =
      typeof row.description === 'string' ? row.description : undefined

    const { value } = row
    const looksLikeAlias =
      typeof value === 'string' && value.startsWith('{') && value.endsWith('}')
    if (looksLikeAlias) {
      const parsed = ALIAS_PATTERN.test(value) ? parseAlias(value) : undefined
      if (parsed?.kind !== 'alias') {
        return unmappable(path, 'The stored alias is malformed.')
      }
      const token: AliasToken = { path, alias: parsed.target }
      if (row.type !== null) token.type = row.type
      if (description !== undefined) token.description = description
      return { ok: true, token, warnings: [] }
    }

    if (row.type === null) {
      return unmappable(path, 'A stored literal has no type.')
    }
    const result = validateLiteral(row.type, value, path)
    if (!result.ok) {
      const first = result.issues[0]
      return unmappable(
        path,
        `The stored value is not a valid ${row.type}${first === undefined ? '' : `: ${first.message}`}.`,
      )
    }
    const token = {
      path,
      type: row.type,
      value: result.value,
    } as LiteralToken
    if (description !== undefined) token.description = description
    return { ok: true, token, warnings: result.issues }
  } catch {
    // Defensive: a pathological value must not take a whole read down.
    return unmappable(
      typeof row.path === 'string' ? row.path : '',
      'The stored row could not be read.',
    )
  }
}

/** A validated token to the columns that are written. */
export function tokenToRow(token: Token): TokenRowData {
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
    value: structuredClone(token.value),
    description,
  }
}
