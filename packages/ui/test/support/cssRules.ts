import * as csstree from 'css-tree'

/**
 * Scanners for the styling rules of component CSS (ADR 0008). They use the
 * css-tree parser, not regular expressions, so comments, strings and selectors
 * are not mistaken for values. Each returns a list of offenders; empty means
 * the rule holds. The tests prove each one can fail on a deliberately bad sample.
 */

/** Functional color notations. Any of them in component CSS is a raw color. */
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

/**
 * Keywords that are allowed even though they relate to color: they carry no
 * color value of their own. System colors such as ButtonText and GrayText are
 * not CSS named colors, so the named-color check does not flag them either
 * (they are what the forced-colors rules use).
 */
const ALLOWED_KEYWORDS = new Set(['transparent', 'inherit', 'currentcolor'])

/** Properties whose identifiers are font names, where a name like "orange" is not a color. */
const FONT_PROPERTIES = new Set(['font-family', 'font'])

const HEX_COLOR = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function parse(css: string): csstree.CssNode {
  return csstree.parse(css, { parseCustomProperty: true })
}

const namedColorCache = new Map<string, boolean>()

/** Is this identifier one of the CSS `<named-color>` keywords (red, rebeccapurple, ...)? */
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

/** Any mention of a primitive variable, even in a comment. Components must not know primitives exist. */
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

const compact = (text: string): string => text.replaceAll(/\s+/g, '')

/** Properties declared inside `@media (forced-colors: active)` blocks. Empty when there is no such block. */
export function forcedColorsProperties(css: string): string[] {
  const found: string[] = []
  csstree.walk(parse(css), {
    visit: 'Atrule',
    enter(atrule) {
      if (
        atrule.name !== 'media' ||
        atrule.prelude === null ||
        !compact(csstree.generate(atrule.prelude)).includes(
          '(forced-colors:active)',
        )
      ) {
        return
      }
      csstree.walk(atrule, {
        visit: 'Declaration',
        enter(declaration) {
          found.push(declaration.property)
        },
      })
    },
  })
  return found
}

/**
 * Problems with focus rings: a `:focus-visible` rule that uses `box-shadow`
 * (removed in forced-colors mode), or a stylesheet where no `:focus-visible`
 * rule draws an `outline`. A rule that only adjusts `outline-color` (for
 * example inside a forced-colors block) is fine as long as another rule draws
 * the outline.
 */
export function findFocusVisibleProblems(css: string): string[] {
  const problems: string[] = []
  let drawsOutline = false
  let sawFocusVisible = false
  csstree.walk(parse(css), {
    visit: 'Rule',
    enter(rule) {
      const selector = csstree.generate(rule.prelude)
      if (!selector.includes(':focus-visible')) return
      sawFocusVisible = true
      csstree.walk(rule.block, {
        visit: 'Declaration',
        enter(declaration) {
          if (declaration.property === 'outline') drawsOutline = true
          if (declaration.property === 'box-shadow') {
            problems.push(`${selector}: box-shadow`)
          }
        },
      })
    },
  })
  if (sawFocusVisible && !drawsOutline) {
    problems.push('no :focus-visible rule draws an outline')
  }
  return problems
}

/** True when the CSS uses `transition` but has no `prefers-reduced-motion: reduce` block that sets it. */
export function transitionWithoutReducedMotion(css: string): boolean {
  let transitions = false
  let reduced = false
  csstree.walk(parse(css), {
    visit: 'Atrule',
    enter(atrule) {
      if (
        atrule.name === 'media' &&
        atrule.prelude !== null &&
        compact(csstree.generate(atrule.prelude)).includes(
          '(prefers-reduced-motion:reduce)',
        )
      ) {
        csstree.walk(atrule, {
          visit: 'Declaration',
          enter(declaration) {
            if (declaration.property === 'transition') reduced = true
          },
        })
      }
    },
  })
  csstree.walk(parse(css), {
    visit: 'Declaration',
    enter(declaration) {
      if (declaration.property === 'transition') transitions = true
    },
  })
  return transitions && !reduced
}

export interface UndefinedVariable {
  theme: string
  variable: string
}

/** Variables the component CSS reads that some theme does not define. */
export function findUndefinedVariables(
  componentCss: string,
  themes: ReadonlyMap<string, ReadonlySet<string>>,
): UndefinedVariable[] {
  const missing: UndefinedVariable[] = []
  for (const variable of findVarReferences(componentCss)) {
    for (const [theme, names] of themes) {
      if (!names.has(variable)) missing.push({ theme, variable })
    }
  }
  return missing
}
