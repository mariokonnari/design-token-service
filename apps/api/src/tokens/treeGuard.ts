import type { Issue } from '@dts/tokens-core'

/**
 * Limits on the SHAPE of an untrusted import tree, checked before tokens-core's
 * `flatten` sees it (ADR 0014).
 *
 * Why: `flatten` is iterative, so it does not overflow the stack, but it copies the
 * path array at every level and is QUADRATIC in depth. Measured on the development
 * machine with a one-token tree nested n levels deep: 5,000 levels = 0.5 s, 10,000 =
 * 2 s, 20,000 = 10.7 s, 50,000 = 68 s of synchronous CPU (the event loop is blocked
 * for everyone), from a 300 KB body that is far below the 512 KB cap. Reported as a
 * tokens-core finding; the guard is what keeps the API safe regardless.
 *
 * The walk is ITERATIVE (an explicit stack): the guard must not have the same flaw.
 * Only plain objects are descended; arrays and primitives are leaves, so a long
 * fontFamily list does not count as nodes.
 */
export const TREE_LIMITS = {
  /** Levels of nested objects; the root is level 1. A token is about 4-5 deep. */
  MAX_DEPTH: 32,
  /** Objects in the whole tree (groups, token objects and object values). */
  MAX_NODES: 10_000,
} as const

/**
 * Names that are refused as a token or group name anywhere: they are the keys that
 * attack plain-object code (`__proto__`, `constructor`, `prototype`). `__proto__`
 * would fail the name pattern anyway; the other two are valid CSS-ish names, so they
 * are refused on purpose, here and in validateSingleToken, so both write paths agree.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

const MAX_RESERVED_REPORTED = 10

function problem(path: string, field: string, message: string): Issue {
  return { code: 'INVALID_STRUCTURE', severity: 'error', path, message, field }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Frame {
  node: Record<string, unknown>
  depth: number
  /** The frame this one hangs from, and the key it hangs under (for reporting only). */
  parent: Frame | undefined
  key: string
}

/** Dotted path of a frame, built only when something is reported (at most a few times). */
function pathOf(frame: Frame, key?: string): string {
  const keys: string[] = key === undefined ? [] : [key]
  for (
    let f: Frame | undefined = frame;
    f?.parent !== undefined;
    f = f.parent
  ) {
    keys.push(f.key)
  }
  return keys.reverse().join('.')
}

/** Issues for a tree that is too deep, too big or uses a reserved name; [] otherwise. */
export function guardTree(tree: unknown): Issue[] {
  if (!isPlainObject(tree)) return [] // flatten reports a non-object root

  const issues: Issue[] = []
  const stack: Frame[] = [{ node: tree, depth: 1, parent: undefined, key: '' }]
  let nodes = 0
  let reserved = 0

  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    nodes += 1
    if (frame.depth > TREE_LIMITS.MAX_DEPTH) {
      return [
        problem(
          '',
          'depth',
          `The tree is nested deeper than ${TREE_LIMITS.MAX_DEPTH} levels.`,
        ),
      ]
    }
    if (nodes > TREE_LIMITS.MAX_NODES) {
      return [
        problem(
          '',
          'nodes',
          `The tree has more than ${TREE_LIMITS.MAX_NODES} objects.`,
        ),
      ]
    }

    for (const key of Object.keys(frame.node)) {
      const child = frame.node[key]
      if (RESERVED_NAMES.has(key) && reserved < MAX_RESERVED_REPORTED) {
        reserved += 1
        issues.push(
          problem(
            pathOf(frame, key),
            'name',
            `"${key}" is a reserved name and cannot be used as a token or group name.`,
          ),
        )
      }
      if (isPlainObject(child)) {
        stack.push({ node: child, depth: frame.depth + 1, parent: frame, key })
      }
    }
  }
  return issues
}
