import { toHex } from './color'
import { cssVarName } from './cssVarName'
import { fontWeightToNumber } from './fontWeights'
import { error, sortIssues } from './issues'
import { comparePaths, isValidName, splitPath } from './names'
import { tierOf, type Tier } from './tiers'
import {
  TOKEN_TYPES,
  type FontFamily,
  type Issue,
  type ResolvedToken,
  type SrgbColor,
} from './types'
import { validateLiteral } from './validate'

/**
 * Where the variables are declared. There is deliberately no way to pass a
 * selector string: the only selectors produced are `:root` and
 * `[data-theme="<slug>"]` with a slug that passed {@link isValidName}.
 */
export type CssScope =
  { kind: 'root' } | { kind: 'attribute'; name: 'data-theme'; value: string }

export interface CssOptions {
  /** Defaults to `{ kind: 'root' }`. */
  scope?: CssScope
  /**
   * Export only tokens in these tiers. When omitted, everything is exported,
   * including tokens outside any tier.
   */
  include?: readonly Tier[]
}

export interface CssResult {
  /** The stylesheet text, or `''` when there is nothing to declare. */
  css: string
  issues: Issue[]
}

/** CSS Fonts 4 `<generic-font-family>` keywords (a W3C Working Draft). */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'system-ui',
  'cursive',
  'fantasy',
  'math',
  'monospace',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
])

/**
 * Names that must be quoted to be read as font names: CSS-wide keywords,
 * `default` (reserved by CSS Fonts), and older generic keywords we do not
 * treat as generics. Quoting extra names is always safe.
 */
const QUOTED_FAMILIES = new Set([
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
  'default',
  'emoji',
  'fangsong',
])

/** One plain ASCII identifier, with at most one leading hyphen (`-apple-system`). */
const IDENTIFIER = /^-?[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * Escapes text for the inside of a double-quoted CSS string: backslash, the
 * double quote, `<` (so `</style>` and `<!--` cannot appear) and, as a second
 * line of defence, control characters (validation already rejects them).
 */
function escapeCssString(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (char === '\\') out += '\\\\'
    else if (char === '"') out += '\\"'
    else if (char === '<') out += '\\3c '
    else if (code <= 0x1f || code === 0x7f) out += `\\${code.toString(16)} `
    else out += char
  }
  return out
}

function serializeFamilyName(name: string): string {
  const lower = name.toLowerCase()
  if (GENERIC_FAMILIES.has(lower)) return lower
  if (IDENTIFIER.test(name) && !QUOTED_FAMILIES.has(lower)) return name
  return `"${escapeCssString(name)}"`
}

function serializeFontFamily(family: FontFamily): string {
  const names = typeof family === 'string' ? [family] : family
  return names.map(serializeFamilyName).join(', ')
}

function serializeColor(color: SrgbColor): string {
  const alpha = Math.round((color.alpha ?? 1) * 1000) / 1000
  if (alpha === 1) return toHex(color.components)
  const [red, green, blue] = color.components.map((component) =>
    Math.round(component * 255),
  )
  return `rgb(${red} ${green} ${blue} / ${alpha})`
}

type Selector = { selector: string } | { issue: Issue }

function invalidOption(field: string, message: string): { issue: Issue } {
  return { issue: error('INVALID_VALUE', '', message, { field }) }
}

/** Checks the scope at runtime too, because callers may pass JSON that bypasses the types. */
function selectorFor(scope: unknown): Selector {
  if (scope === undefined) return { selector: ':root' }
  if (typeof scope !== 'object' || scope === null) {
    return invalidOption('scope', 'scope must be an object')
  }
  const { kind, name, value } = scope as Record<string, unknown>
  if (kind === 'root') return { selector: ':root' }
  if (kind !== 'attribute') {
    return invalidOption(
      'scope.kind',
      'scope.kind must be "root" or "attribute"',
    )
  }
  if (name !== 'data-theme') {
    return invalidOption(
      'scope.name',
      'Only the "data-theme" attribute is supported',
    )
  }
  if (typeof value !== 'string' || !isValidName(value)) {
    return invalidOption(
      'scope.value',
      'The theme slug must use lowercase letters, digits and single hyphens only',
    )
  }
  return { selector: `[data-theme="${value}"]` }
}

interface Declaration {
  path: string
  name: string
  value: string
}

/**
 * Exports resolved tokens as CSS custom properties. Values are literals
 * computed from the resolved tokens, never `var()` chains.
 *
 * The output is `<selector> {`, one `  --name: value;` line per token sorted by
 * path, then `}`. Nothing is trusted from the input: paths must be valid names,
 * values are re-validated, and tokens that fail are omitted with an issue.
 * Variable names that collide (`a.b-c` and `a-b.c` both give `--a-b-c`) are all
 * omitted with CSS_NAME_COLLISION. Never throws.
 */
export function toCssVariables(
  resolved: readonly ResolvedToken[],
  options: CssOptions = {},
): CssResult {
  const issues: Issue[] = []

  const target = selectorFor(options.scope)
  if ('issue' in target) issues.push(target.issue)
  const include: unknown = options.include
  if (include !== undefined && !Array.isArray(include)) {
    issues.push(
      error('INVALID_VALUE', '', 'include must be an array of tiers', {
        field: 'include',
      }),
    )
  }
  if (issues.length > 0 || !('selector' in target)) {
    return { css: '', issues: sortIssues(issues) }
  }
  const tiers = Array.isArray(include) ? new Set<unknown>(include) : undefined

  const accepted: Declaration[] = []
  const seen = new Set<string>()
  const sorted = [...resolved].sort((a, b) =>
    comparePaths(String(a.path), String(b.path)),
  )

  for (const token of sorted) {
    const path: unknown = token.path
    if (typeof path !== 'string') {
      issues.push(error('INVALID_NAME', '', 'A token path must be a string'))
      continue
    }
    if (tiers !== undefined) {
      const tier = tierOf(path)
      if (tier === undefined || !tiers.has(tier)) continue
    }
    if (seen.has(path)) {
      issues.push(
        error(
          'PATH_CONFLICT',
          path,
          `Duplicate token path "${path}"; the first definition is used`,
        ),
      )
      continue
    }
    seen.add(path)

    const segments = splitPath(path)
    if (segments.length === 0 || !segments.every(isValidName)) {
      issues.push(
        error(
          'INVALID_NAME',
          path,
          'The path is empty or contains a segment that is not a valid name, so it cannot become a CSS variable name',
        ),
      )
      continue
    }
    if (!(TOKEN_TYPES as readonly string[]).includes(token.type)) {
      issues.push(
        error('INVALID_TYPE', path, 'The token type is not a supported type', {
          field: 'type',
        }),
      )
      continue
    }

    const checked = validateLiteral(token.type, token.value, path)
    if (!checked.ok) {
      issues.push(
        ...checked.issues.filter((issue) => issue.severity === 'error'),
      )
      continue
    }

    let value: string | undefined
    switch (token.type) {
      case 'color':
        value = serializeColor(checked.value as SrgbColor)
        break
      case 'dimension': {
        const dimension = checked.value as { value: number; unit: string }
        value = `${dimension.value}${dimension.unit}`
        break
      }
      case 'fontFamily':
        value = serializeFontFamily(checked.value as FontFamily)
        break
      case 'fontWeight': {
        const weight = fontWeightToNumber(checked.value as number | string)
        value = weight === undefined ? undefined : String(weight)
        break
      }
      case 'number':
        if (typeof checked.value === 'number') value = String(checked.value)
        break
    }
    if (value === undefined) {
      issues.push(
        error('INVALID_VALUE', path, 'The value cannot be serialized'),
      )
      continue
    }
    accepted.push({ path, name: cssVarName(path), value })
  }

  const byName = new Map<string, Declaration[]>()
  for (const declaration of accepted) {
    const group = byName.get(declaration.name) ?? []
    group.push(declaration)
    byName.set(declaration.name, group)
  }

  const colliding = new Set<string>()
  for (const [name, group] of byName) {
    if (group.length < 2) continue
    const paths = group
      .map((declaration) => declaration.path)
      .sort(comparePaths)
    for (const path of paths) {
      colliding.add(path)
      issues.push(
        error(
          'CSS_NAME_COLLISION',
          path,
          `${paths.map((p) => `"${p}"`).join(' and ')} all map to ${name}; none of them is exported`,
          { related: paths },
        ),
      )
    }
  }

  const lines = accepted
    .filter((declaration) => !colliding.has(declaration.path))
    .map((declaration) => `  ${declaration.name}: ${declaration.value};\n`)

  return {
    css: lines.length === 0 ? '' : `${target.selector} {\n${lines.join('')}}\n`,
    issues: sortIssues(issues),
  }
}
