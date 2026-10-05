import { error, sortIssues } from './issues'
import { comparePaths } from './names'
import type {
  AliasToken,
  Issue,
  ResolvedToken,
  Token,
  TokenType,
  TokenValue,
} from './types'
import { cloneValue } from './validate'

export interface ResolveOptions {
  /**
   * Paths that `flatten()` dropped as invalid. An alias to one of these is
   * reported as ALIAS_TARGET_INVALID instead of ALIAS_NOT_FOUND.
   */
  rejected?: readonly string[]
}

export interface ResolveResult {
  /** Fully resolved tokens, sorted by path. Tokens with errors are omitted. */
  resolved: ResolvedToken[]
  issues: Issue[]
}

type Outcome =
  | { kind: 'ok'; type: TokenType; value: TokenValue; resolvesTo: string }
  | { kind: 'failed' }
  | { kind: 'cycle'; text: string; members: readonly string[] }

interface Frame {
  token: AliasToken
  /** True once the alias target has been pushed and we are waiting for it. */
  awaiting: boolean
}

function isAlias(token: Token): token is AliasToken {
  return 'alias' in token
}

/** Longest cycle spelled out in full in a message; longer ones are abbreviated. */
const MAX_CYCLE_TEXT = 10

/** `a -> b -> c -> a`, written as seen from `members[start]`. */
function formatCycle(members: readonly string[], start: number): string {
  const size = members.length
  const at = (offset: number) => members[(start + offset) % size] ?? ''
  const shown: string[] = []
  if (size <= MAX_CYCLE_TEXT) {
    for (let i = 0; i < size; i++) shown.push(at(i))
  } else {
    for (let i = 0; i < 5; i++) shown.push(at(i))
    shown.push(`... (${size - 6} more)`, at(size - 1))
  }
  return `${shown.join(' -> ')} -> ${at(0)}`
}

/**
 * Resolves alias chains to literal values.
 *
 * - Iterative DFS with an explicit stack and a memo, so very long chains
 *   cannot overflow the call stack and shared targets are resolved once.
 * - Never throws; every failing token gets at least one error issue
 *   (ALIAS_NOT_FOUND, ALIAS_TARGET_INVALID, ALIAS_CYCLE or TYPE_MISMATCH).
 * - An alias without a declared type takes its target's type; a declared type
 *   must match it.
 * - Output and issues are sorted by path, independent of input order.
 */
export function resolve(
  tokens: readonly Token[],
  options: ResolveOptions = {},
): ResolveResult {
  const issues: Issue[] = []
  const byPath = new Map<string, Token>()
  for (const token of tokens) {
    if (byPath.has(token.path)) {
      issues.push(
        error(
          'PATH_CONFLICT',
          token.path,
          `Duplicate token path "${token.path}"; the first definition is used`,
        ),
      )
    } else {
      byPath.set(token.path, token)
    }
  }

  const rejected = new Set(options.rejected ?? [])

  // Proper prefixes of token paths, to tell "a group" apart from "nothing".
  const groups = new Set<string>()
  for (const path of byPath.keys()) {
    for (
      let dot = path.indexOf('.');
      dot !== -1;
      dot = path.indexOf('.', dot + 1)
    ) {
      groups.add(path.slice(0, dot))
    }
  }

  const order = [...byPath.keys()].sort(comparePaths)
  const outcomes = new Map<string, Outcome>()
  const stack: Frame[] = []
  const onStack = new Map<string, number>()

  function literalOutcome(token: Exclude<Token, AliasToken>): Outcome {
    return {
      kind: 'ok',
      type: token.type,
      value: token.value,
      resolvesTo: token.path,
    }
  }

  function pop(): Frame | undefined {
    const frame = stack.pop()
    if (frame !== undefined) onStack.delete(frame.token.path)
    return frame
  }

  function fail(frame: Frame, issue: Issue): void {
    issues.push(issue)
    outcomes.set(frame.token.path, { kind: 'failed' })
    pop()
  }

  function complete(frame: Frame, target: Outcome | undefined): void {
    const { token } = frame
    const targetPath = token.alias
    if (target === undefined || target.kind === 'failed') {
      fail(
        frame,
        error(
          'ALIAS_TARGET_INVALID',
          token.path,
          `Alias target "${targetPath}" could not be resolved; see the issue reported for "${targetPath}"`,
          { field: '$value', related: [targetPath] },
        ),
      )
    } else if (target.kind === 'cycle') {
      issues.push(
        error(
          'ALIAS_CYCLE',
          token.path,
          `Alias depends on a cycle: ${target.text}`,
          { field: '$value', related: target.members },
        ),
      )
      outcomes.set(token.path, target)
      pop()
    } else if (token.type !== undefined && token.type !== target.type) {
      fail(
        frame,
        error(
          'TYPE_MISMATCH',
          token.path,
          `Declared type "${token.type}" does not match the type "${target.type}" of "${targetPath}"`,
          { field: '$type', related: [targetPath] },
        ),
      )
    } else {
      outcomes.set(token.path, { ...target })
      pop()
    }
  }

  /** `stack[from..]` is a cycle: report every member and pop them. */
  function closeCycle(from: number): void {
    const members = stack.slice(from).map((frame) => frame.token.path)
    let first = 0
    members.forEach((path, index) => {
      if (comparePaths(path, members[first] ?? '') < 0) first = index
    })
    const related = [...members.slice(first), ...members.slice(0, first)]

    members.forEach((path, index) => {
      const text = formatCycle(members, index)
      issues.push(
        error('ALIAS_CYCLE', path, `Alias cycle: ${text}`, {
          field: '$value',
          related,
        }),
      )
      outcomes.set(path, { kind: 'cycle', text, members: related })
    })
    while (stack.length > from) pop()
  }

  for (const start of order) {
    if (outcomes.has(start)) continue
    const startToken = byPath.get(start)
    if (startToken === undefined) continue
    if (!isAlias(startToken)) {
      outcomes.set(start, literalOutcome(startToken))
      continue
    }

    stack.push({ token: startToken, awaiting: false })
    onStack.set(start, 0)

    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const target = frame.token.alias

      if (frame.awaiting) {
        complete(frame, outcomes.get(target))
        continue
      }

      const targetToken = byPath.get(target)
      if (targetToken === undefined) {
        fail(
          frame,
          rejected.has(target)
            ? error(
                'ALIAS_TARGET_INVALID',
                frame.token.path,
                `Alias target "${target}" was rejected while reading the input; see the issue reported for "${target}" or its parent group`,
                { field: '$value', related: [target] },
              )
            : error(
                'ALIAS_NOT_FOUND',
                frame.token.path,
                groups.has(target)
                  ? `Alias target "${target}" is a group; aliases must point at a token`
                  : `Alias target "${target}" does not exist`,
                { field: '$value', related: [target] },
              ),
        )
        continue
      }

      const known = outcomes.get(target)
      if (known !== undefined) {
        complete(frame, known)
        continue
      }
      if (!isAlias(targetToken)) {
        const literal = literalOutcome(targetToken)
        outcomes.set(target, literal)
        complete(frame, literal)
        continue
      }

      const cycleStart = onStack.get(target)
      if (cycleStart !== undefined) {
        closeCycle(cycleStart)
        continue
      }

      frame.awaiting = true
      stack.push({ token: targetToken, awaiting: false })
      onStack.set(target, stack.length - 1)
    }
  }

  const resolved: ResolvedToken[] = []
  for (const path of order) {
    const token = byPath.get(path)
    const outcome = outcomes.get(path)
    if (token === undefined || outcome?.kind !== 'ok') continue

    const entry = {
      path,
      type: outcome.type,
      value: cloneValue(outcome.value),
    } as ResolvedToken
    if (token.description !== undefined) entry.description = token.description
    if (isAlias(token)) {
      entry.aliasOf = token.alias
      entry.resolvesTo = outcome.resolvesTo
    }
    resolved.push(entry)
  }

  return { resolved, issues: sortIssues(issues) }
}
