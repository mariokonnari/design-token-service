import * as csstree from 'css-tree'

/**
 * A COPY of six scanners from packages/ui/test/support/cssRules.ts (ADR 0008).
 * They are not shared on purpose: that file lives in ui's test folder, outside the
 * package's exports, and importing it by relative path would reach across package
 * boundaries that ESLint guards (ADR 0005). The ui original is the source of truth;
 * if a rule changes there, change it here too and add the case to
 * test/cssRules.test.ts, which has its own bad-sample self-tests for each scanner.
 *
 * They use the css-tree parser, not regular expressions, so comments, strings and
 * selectors are not mistaken for values. Each returns a list of offenders; empty
 * means the rule holds.
 */

/** Functional color notations. Any of them in CSS is a raw color. */
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
])

/** Keywords related to color that carry no color value of their own. System colors (ButtonText, GrayText...) are not named colors. */
const ALLOWED_KEYWORDS = new Set(['transparent', 'inherit', 'currentcolor'])

/** Properties whose identifiers are font names, where "orange" is not a color. */
const FONT_PROPERTIES = new Set(['font-family', 'font'])

const HEX_COLOR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function parse(css: string): csstree.CssNode {
  return csstree.parse(css, { parseCustomProperty: true })
}

const namedColorCache = new Map<string, boolean>()

function isNamedColor(identifier: string): boolean {
  const name = identifier.toLowerCase()
  const cached = namedColorCache.get(name)
  if (cached !== undefined) return cached
  const match = csstree.lexer.matchType(
    'named-color',
    csstree.parse(name, { context: 'value' }),
  )
  const result = match.matched !== null && match.matched !== undefined
  namedColorCache.set(name, result)
  return result
}

/** Any mention of a primitive variable, even in a comment. */
export function findPrimitiveReferences(css: string): string[] {
  return css.match(/--primitive-[a-z0-9-]*/g) ?? []
}

/** Hex colors, color functions and named colors in declaration values. */
export function findRawColors(css: string): string[] {
  const found: string[] = []
  csstree.walk(parse(css), {
    visit: 'Declaration',
    enter(declaration) {
      if (FONT_PROPERTIES.has(declaration.property.toLowerCase())) return
      csstree.walk(declaration.value, (node) => {
        if (node.type === 'Hash' && HEX_COLOR.test(node.value)) {
          found.push(`#${node.value}`)
        } else if (
          node.type === 'Function' &&
          COLOR_FUNCTIONS.has(node.name.toLowerCase())
        ) {
          found.push(`${node.name}()`)
        } else if (node.type === 'Identifier') {
          const name = node.name.toLowerCase()
          if (!ALLOWED_KEYWORDS.has(name) && isNamedColor(name)) {
            found.push(node.name)
          }
        }
      })
    },
  })
  return found
}

/** `var()` calls with a fallback, e.g. `var(--x, 4px)` or `var(--x,)`. */
export function findVarFallbacks(css: string): string[] {
  const found: string[] = []
  csstree.walk(parse(css), (node) => {
    if (node.type === 'Function' && node.name.toLowerCase() === 'var') {
      const hasComma = node.children
        .toArray()
        .some((child) => child.type === 'Operator' && child.value === ',')
      if (hasComma) found.push(csstree.generate(node))
    }
  })
  return found
}

/** Names of the custom properties read through `var()`. */
export function findVarReferences(css: string): string[] {
  const found = new Set<string>()
  csstree.walk(parse(css), (node) => {
    if (node.type === 'Function' && node.name.toLowerCase() === 'var') {
      const first = node.children.first
      if (first?.type === 'Identifier') found.add(first.name)
    }
  })
  return [...found].sort()
}

/** The custom properties declared in each `[data-theme="slug"]` rule of the generated theme CSS. */
export function declaredVariables(themesCss: string): Map<string, Set<string>> {
  const themes = new Map<string, Set<string>>()
  csstree.walk(parse(themesCss), {
    visit: 'Rule',
    enter(rule) {
      const slug = /^\[data-theme="([^"]+)"\]$/.exec(
        csstree.generate(rule.prelude),
      )?.[1]
      if (slug === undefined) return
      const names = themes.get(slug) ?? new Set<string>()
      csstree.walk(rule.block, {
        visit: 'Declaration',
        enter(declaration) {
          if (declaration.property.startsWith('--')) {
            names.add(declaration.property)
          }
        },
      })
      themes.set(slug, names)
    },
  })
  return themes
}

export interface UndefinedVariable {
  theme: string
  variable: string
}

/** Variables the CSS reads that some theme does not define. */
export function findUndefinedVariables(
  css: string,
  themes: ReadonlyMap<string, ReadonlySet<string>>,
): UndefinedVariable[] {
  const missing: UndefinedVariable[] = []
  for (const variable of findVarReferences(css)) {
    for (const [theme, names] of themes) {
      if (!names.has(variable)) missing.push({ theme, variable })
    }
  }
  return missing
}
