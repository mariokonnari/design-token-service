import {
  tokenFromParts,
  tokenToParts,
  type Issue,
  type IssueCode,
  type Token,
} from '@dts/tokens-core'

/**
 * DB row <-> tokens-core Token. PURE: no Prisma, no I/O (the lint rule keeps the
 * generated client inside src/db and src/repositories, and the mapper is tested
 * without a database). The row <-> token rules live in tokens-core
 * (`tokenFromParts` / `tokenToParts`, shared with the web editor); this file only
 * turns a failure into the API's UNMAPPABLE_ROW issue (ADR 0017).
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

/** A stored row to a token, or an UNMAPPABLE_ROW issue. Never throws. */
export function rowToToken(row: TokenRowInput): MapResult {
  const result = tokenFromParts({
    path: row.path,
    type: row.type,
    value: row.value,
    description: row.description,
  })
  if (result.ok) return result
  return {
    ok: false,
    issue: {
      code: 'UNMAPPABLE_ROW',
      severity: 'error',
      path: String(row.path),
      message: result.message,
    },
  }
}

/** A validated token to the columns that are written. */
export function tokenToRow(token: Token): TokenRowData {
  return tokenToParts(token)
}
