import { tokenFromParts, type Token } from '@dts/tokens-core'
import type { ServerToken } from '../api/types'

/** A readable draft token with the version the server holds (the `expectedVersion` of the next write). */
export interface Entry {
  token: Token
  version: number
}

/**
 * A stored row that is not a valid token (a raw database edit, an old bug). It is
 * listed, with the reason, and can be deleted, but not edited.
 */
export interface UnreadableRow {
  path: string
  version: number
  message: string
}

/**
 * The API's rows to tokens, with the SAME mapper the API uses (tokens-core
 * `tokenFromParts`), so the browser and the server read a stored token the same way.
 * Never throws: a bad row becomes an UnreadableRow.
 */
export function readTokenList(rows: readonly ServerToken[]): {
  entries: Entry[]
  unreadable: UnreadableRow[]
} {
  const entries: Entry[] = []
  const unreadable: UnreadableRow[] = []
  for (const row of rows) {
    const result = tokenFromParts({
      path: row.path,
      type: row.type,
      value: row.value,
      description: row.description,
    })
    if (result.ok) {
      entries.push({ token: result.token, version: row.version })
    } else {
      unreadable.push({
        path: String(row.path),
        version: row.version,
        message: result.message,
      })
    }
  }
  return { entries, unreadable }
}
