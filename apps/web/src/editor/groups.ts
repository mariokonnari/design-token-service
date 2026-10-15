import {
  comparePaths,
  resolve,
  splitPath,
  tierOf,
  toHex,
  type ResolvedToken,
  type Token,
} from '@dts/tokens-core'
import type { UnreadableRow } from './rows'
import { formatTokenValue } from './values'

/** One row of the token list. `display` is the value as TEXT; it is never empty. */
export interface ListItem {
  path: string
  /** The effective type (an alias takes its target's); null when it cannot be resolved. */
  type: string | null
  display: string
  /** A #rrggbb colour for the decorative swatch, when the token resolves to a colour. */
  swatch?: string
  description?: string
  unreadable?: boolean
  /** Why a stored row cannot be read. */
  message?: string
}

export interface Group {
  /** The first two path segments, e.g. `primitive.color`. */
  name: string
  items: ListItem[]
}

export interface Groups {
  primitive: Group[]
  semantic: Group[]
  component: Group[]
  /** Tokens outside the three tiers. */
  other: Group[]
}

export function buildListItems(
  tokens: readonly Token[],
  unreadable: readonly UnreadableRow[],
): ListItem[] {
  const resolvedBy = new Map<string, ResolvedToken>()
  for (const resolved of resolve(tokens).resolved) {
    resolvedBy.set(resolved.path, resolved)
  }
  const items: ListItem[] = tokens.map((token) => {
    const resolved = resolvedBy.get(token.path)
    const item: ListItem = {
      path: token.path,
      type: resolved?.type ?? ('alias' in token ? null : token.type),
      display: formatTokenValue(token),
    }
    if (resolved?.type === 'color')
      item.swatch = toHex(resolved.value.components)
    if (token.description !== undefined) item.description = token.description
    return item
  })
  for (const row of unreadable) {
    items.push({
      path: row.path,
      type: null,
      display: 'Unreadable value',
      unreadable: true,
      message: row.message,
    })
  }
  return items.sort((a, b) => comparePaths(a.path, b.path))
}

export function groupByTier(items: readonly ListItem[]): Groups {
  const groups: Groups = {
    primitive: [],
    semantic: [],
    component: [],
    other: [],
  }
  const index = new Map<string, Group>()
  for (const item of items) {
    const tier = tierOf(item.path) ?? 'other'
    const name = splitPath(item.path).slice(0, 2).join('.')
    const key = `${tier}|${name}`
    let group = index.get(key)
    if (group === undefined) {
      group = { name, items: [] }
      index.set(key, group)
      groups[tier].push(group)
    }
    group.items.push(item)
  }
  return groups
}

/** Case-insensitive substring over path, type, description and the shown value. A query is text, never a pattern. */
export function filterItems(
  items: readonly ListItem[],
  query: string,
): ListItem[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...items]
  return items.filter((item) =>
    `${item.path}\n${item.type ?? ''}\n${item.description ?? ''}\n${item.display}`
      .toLowerCase()
      .includes(needle),
  )
}
