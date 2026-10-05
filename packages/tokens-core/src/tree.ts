import { error, hasError, sortIssues, warning } from './issues'
import {
  comparePaths,
  isValidName,
  joinPath,
  parseAlias,
  splitPath,
} from './names'
import {
  TOKEN_TYPES,
  type AliasToken,
  type Issue,
  type LiteralToken,
  type Token,
  type TokenTree,
  type TokenType,
} from './types'
import { cloneValue, validateLiteral } from './validate'

export interface FlattenResult {
  /** Valid tokens, sorted by path. */
  tokens: Token[]
  issues: Issue[]
  /**
   * Paths of tokens that were present in the input but dropped because they are
   * invalid. Pass to `resolve()` so aliases to them are reported accurately.
   */
  rejected: string[]
}

/** DTCG 2025.10 types that exist in the spec but are outside this subset. */
const UNSUPPORTED_SPEC_TYPES = new Set([
  'duration',
  'cubicBezier',
  'strokeStyle',
  'border',
  'transition',
  'shadow',
  'gradient',
  'typography',
])

type InheritedType =
  { kind: 'none' } | { kind: 'type'; type: TokenType } | { kind: 'invalid' }

type TypeReading = { kind: 'type'; type: TokenType } | { kind: 'invalid' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTokenType(value: string): value is TokenType {
  return (TOKEN_TYPES as readonly string[]).includes(value)
}

function childPath(parent: readonly string[], key: string): string {
  return joinPath([...parent, key])
}

/** Reads a `$type` value, reporting anything that is not a supported type. */
function readType(raw: unknown, path: string, issues: Issue[]): TypeReading {
  if (typeof raw === 'string' && isTokenType(raw)) {
    return { kind: 'type', type: raw }
  }
  if (typeof raw === 'string' && UNSUPPORTED_SPEC_TYPES.has(raw)) {
    issues.push(
      error('UNSUPPORTED_TYPE', path, `Type "${raw}" is not supported`, {
        field: '$type',
      }),
    )
  } else {
    issues.push(
      error(
        'INVALID_TYPE',
        path,
        `$type must be one of ${TOKEN_TYPES.join(', ')}`,
        { field: '$type' },
      ),
    )
  }
  return { kind: 'invalid' }
}

interface GroupFrame {
  node: Record<string, unknown>
  segments: string[]
  inherited: InheritedType
}

/**
 * Parses a nested DTCG-style object into a flat, sorted token list.
 *
 * Never throws: every problem becomes an issue. Rules, in short:
 * - an object with `$value` is a token, any other object is a group;
 * - names must satisfy {@link isValidName}; a bad name skips its subtree;
 * - a token's type is its own `$type`, else (for literals only) the closest
 *   group `$type`; an alias takes its type from its target (resolve());
 * - an error on a token drops that token (and lists it in `rejected`);
 *   group-level errors do not drop tokens;
 * - group `$description` is accepted and dropped, as are empty groups.
 */
export function flatten(tree: unknown): FlattenResult {
  const tokens: Token[] = []
  const issues: Issue[] = []
  const rejected = new Set<string>()

  function finish(): FlattenResult {
    return {
      tokens: tokens.sort((a, b) => comparePaths(a.path, b.path)),
      issues: sortIssues(issues),
      rejected: [...rejected].sort(comparePaths),
    }
  }

  if (!isRecord(tree)) {
    issues.push(
      error('INVALID_STRUCTURE', '', 'The document root must be an object'),
    )
    return finish()
  }
  if (Object.hasOwn(tree, '$value')) {
    issues.push(
      error(
        'INVALID_STRUCTURE',
        '',
        'The document root must be a group, not a token (it has $value)',
        { field: '$value' },
      ),
    )
    return finish()
  }

  function readToken(
    node: Record<string, unknown>,
    segments: readonly string[],
    inherited: InheritedType,
  ): void {
    const path = joinPath(segments)
    const found: Issue[] = []

    for (const key of Object.keys(node)) {
      if (key === '$value' || key === '$type' || key === '$description')
        continue
      if (key === '$ref') {
        found.push(
          error(
            'UNSUPPORTED_FEATURE',
            path,
            'JSON Pointer references ($ref) are not supported; use a {curly.brace} alias',
            { field: '$ref' },
          ),
        )
      } else if (key.startsWith('$')) {
        found.push(
          warning('UNSUPPORTED_FEATURE', path, `Property ${key} is ignored`, {
            field: key,
          }),
        )
      } else {
        found.push(
          error(
            'INVALID_STRUCTURE',
            path,
            `A token cannot also contain children (found "${key}")`,
            { field: key },
          ),
        )
        break
      }
    }

    const description = node['$description']
    if (description !== undefined && typeof description !== 'string') {
      found.push(
        error('INVALID_STRUCTURE', path, '$description must be a string', {
          field: '$description',
        }),
      )
    }

    let declared: TokenType | undefined
    if (Object.hasOwn(node, '$type')) {
      const reading = readType(node['$type'], path, found)
      if (reading.kind === 'type') declared = reading.type
    }
    const typeBroken = Object.hasOwn(node, '$type') && declared === undefined

    const raw = node['$value']
    let token: Token | undefined
    if (typeof raw === 'string' && raw.startsWith('{') && raw.endsWith('}')) {
      const parsed = parseAlias(raw)
      if (parsed.kind === 'alias') {
        const alias: AliasToken = { path, alias: parsed.target }
        if (declared !== undefined) alias.type = declared
        token = alias
      } else if (parsed.kind === 'malformed') {
        found.push(
          error('INVALID_VALUE', path, `Malformed alias: ${parsed.reason}`, {
            field: '$value',
          }),
        )
      }
    } else if (!typeBroken) {
      let type: TokenType | undefined = declared
      if (type === undefined) {
        if (inherited.kind === 'type') type = inherited.type
        else if (inherited.kind === 'none') {
          found.push(
            error(
              'MISSING_TYPE',
              path,
              'No $type on the token or any parent group',
              { field: '$type' },
            ),
          )
        }
        // inherited.kind === 'invalid': the group already reported it.
      }
      if (type !== undefined) {
        const result = validateLiteral(type, raw, path)
        found.push(...result.issues)
        if (result.ok) {
          token = { path, type, value: result.value } as LiteralToken
        }
      }
    }

    issues.push(...found)
    if (token === undefined || hasError(found)) {
      rejected.add(path)
      return
    }
    if (typeof description === 'string') token.description = description
    tokens.push(token)
  }

  const stack: GroupFrame[] = [
    { node: tree, segments: [], inherited: { kind: 'none' } },
  ]

  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    const { node, segments } = frame
    const path = joinPath(segments)
    let inherited = frame.inherited

    if (Object.hasOwn(node, '$type')) {
      const reading = readType(node['$type'], path, issues)
      inherited =
        reading.kind === 'type'
          ? { kind: 'type', type: reading.type }
          : { kind: 'invalid' }
    }

    for (const key of Object.keys(node)) {
      if (key === '$type') continue

      if (key.startsWith('$')) {
        if (key === '$description') {
          if (typeof node[key] !== 'string') {
            issues.push(
              error(
                'INVALID_STRUCTURE',
                path,
                '$description must be a string',
                {
                  field: key,
                },
              ),
            )
          }
        } else if (key === '$extends') {
          issues.push(
            error(
              'UNSUPPORTED_FEATURE',
              path,
              'Group extension ($extends) is not supported',
              {
                field: key,
              },
            ),
          )
        } else if (key === '$root') {
          issues.push(
            error(
              'UNSUPPORTED_FEATURE',
              childPath(segments, key),
              'Root tokens ($root) are not supported',
            ),
          )
        } else if (key === '$ref') {
          issues.push(
            error(
              'UNSUPPORTED_FEATURE',
              path,
              'JSON Pointer references ($ref) are not supported; use a {curly.brace} alias',
              { field: key },
            ),
          )
          if (segments.length > 0) rejected.add(path)
        } else {
          issues.push(
            warning('UNSUPPORTED_FEATURE', path, `Property ${key} is ignored`, {
              field: key,
            }),
          )
        }
        continue
      }

      const keyPath = childPath(segments, key)
      if (!isValidName(key)) {
        issues.push(
          error(
            'INVALID_NAME',
            keyPath,
            `"${key}" is not a valid name: use lowercase letters and digits in hyphen-separated groups (e.g. "blue-500")`,
          ),
        )
        continue
      }

      const child = node[key]
      if (!isRecord(child)) {
        issues.push(
          error(
            'INVALID_STRUCTURE',
            keyPath,
            'Expected a group or token object',
          ),
        )
        rejected.add(keyPath)
      } else if (Object.hasOwn(child, '$value')) {
        readToken(child, [...segments, key], inherited)
      } else {
        stack.push({ node: child, segments: [...segments, key], inherited })
      }
    }
  }

  return finish()
}

function isTokenNode(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, '$value')
}

export interface NestResult {
  tree: TokenTree
  issues: Issue[]
}

/**
 * Builds a nested DTCG-style object from tokens. Every token is written with
 * its own `$type` (aliases only when one was declared), so group-level `$type`
 * from the original input is not reproduced. Keys come out in the same order
 * `flatten` sorts paths. Never throws.
 */
export function nest(tokens: readonly Token[]): NestResult {
  const tree: TokenTree = {}
  const issues: Issue[] = []

  const sorted = [...tokens].sort((a, b) => comparePaths(a.path, b.path))
  for (const token of sorted) {
    const segments = splitPath(token.path)
    if (segments.length === 0 || !segments.every(isValidName)) {
      issues.push(
        error(
          'INVALID_NAME',
          token.path,
          'The path is empty or contains a segment that is not a valid name',
        ),
      )
      continue
    }

    let cursor = tree
    let conflict: string | undefined
    for (const [index, segment] of segments.slice(0, -1).entries()) {
      const existing = Object.hasOwn(cursor, segment)
        ? cursor[segment]
        : undefined
      if (existing === undefined) {
        const group: TokenTree = {}
        cursor[segment] = group
        cursor = group
      } else if (isRecord(existing) && !isTokenNode(existing)) {
        cursor = existing
      } else {
        conflict = joinPath(segments.slice(0, index + 1))
        break
      }
    }
    const last = segments[segments.length - 1] ?? ''
    if (conflict === undefined && Object.hasOwn(cursor, last)) {
      conflict = token.path
    }
    if (conflict !== undefined) {
      issues.push(
        error(
          'PATH_CONFLICT',
          token.path,
          conflict === token.path
            ? `Duplicate token path "${token.path}"; the first definition is kept`
            : `"${conflict}" is a token, so "${token.path}" cannot be nested under it`,
          { related: [conflict] },
        ),
      )
      continue
    }

    const node: Record<string, unknown> = {}
    if ('alias' in token) {
      if (token.type !== undefined) node['$type'] = token.type
      node['$value'] = `{${token.alias}}`
    } else {
      node['$type'] = token.type
      node['$value'] = cloneValue(token.value)
    }
    if (token.description !== undefined)
      node['$description'] = token.description
    cursor[last] = node
  }

  return { tree, issues: sortIssues(issues) }
}
