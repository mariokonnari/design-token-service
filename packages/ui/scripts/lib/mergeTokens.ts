/**
 * Overlay semantics for theme token files (ADR 0008).
 *
 * `default.tokens.json` is the complete base. Every other `<slug>.tokens.json`
 * is an overlay merged onto it:
 * - groups merge recursively;
 * - a token (an object with `$value`) replaces the base token of the same path
 *   wholesale, its properties are not merged;
 * - anything the overlay adds is added;
 * - a token-versus-group conflict, or an overlay that changes a group's
 *   `$type` or other `$` property, is an error, because it would silently
 *   change the meaning of base tokens.
 *
 * Trees are plain JSON. The result is built from null-prototype objects and a
 * `__proto__` key is rejected, so a hostile file cannot touch prototypes.
 */

export class MergeError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path === '' ? '(root)' : path}: ${message}`)
    this.name = 'MergeError'
    this.path = path
  }
}

type Tree = Record<string, unknown>

function isRecord(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToken(value: unknown): boolean {
  return isRecord(value) && Object.hasOwn(value, '$value')
}

function childPath(parent: string, key: string): string {
  return parent === '' ? key : `${parent}.${key}`
}

function assertSafeKey(key: string, path: string): void {
  if (key === '__proto__') {
    throw new MergeError(
      childPath(path, key),
      'the key "__proto__" is not allowed',
    )
  }
}

/** A deep copy that uses null-prototype objects and refuses `__proto__`. */
function clone(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown, index) => clone(item, `${path}[${index}]`))
  }
  if (isRecord(value)) {
    const copy: Tree = Object.create(null) as Tree
    for (const key of Object.keys(value)) {
      assertSafeKey(key, path)
      copy[key] = clone(value[key], childPath(path, key))
    }
    return copy
  }
  return value
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeGroup(base: Tree, overlay: Tree, path: string): Tree {
  const result = clone(base, path) as Tree

  for (const key of Object.keys(overlay)) {
    assertSafeKey(key, path)
    const value = overlay[key]

    if (key.startsWith('$')) {
      if (Object.hasOwn(result, key) && !sameJson(result[key], value)) {
        throw new MergeError(
          path,
          `the overlay changes ${key} of this group, which would change base tokens`,
        )
      }
      result[key] = clone(value, childPath(path, key))
      continue
    }

    const here = childPath(path, key)
    if (!Object.hasOwn(result, key)) {
      result[key] = clone(value, here)
      continue
    }

    const existing = result[key]
    if (!isRecord(existing) || !isRecord(value)) {
      throw new MergeError(here, 'expected a group or a token on both sides')
    }
    if (isToken(existing) !== isToken(value)) {
      throw new MergeError(
        here,
        isToken(existing)
          ? 'the base has a token here but the overlay has a group'
          : 'the base has a group here but the overlay has a token',
      )
    }
    result[key] = isToken(value)
      ? clone(value, here)
      : mergeGroup(existing, value, here)
  }
  return result
}

/** Merges an overlay onto a base token tree. Throws {@link MergeError}. */
export function mergeTokenTrees(base: unknown, overlay: unknown): Tree {
  if (!isRecord(base)) throw new MergeError('', 'the base must be an object')
  if (!isRecord(overlay)) {
    throw new MergeError('', 'the overlay must be an object')
  }
  return mergeGroup(base, overlay, '')
}
