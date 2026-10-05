import * as csstree from 'css-tree'
import { expect } from 'vitest'

/**
 * An independent oracle for exporter output: the css-tree parser (a real,
 * spec-driven CSS parser, with custom-property values parsed rather than kept
 * as opaque text) plus its value-grammar lexer. It sees structure (how many
 * rules and declarations the CSS really contains) and, for typed properties,
 * whether a value is valid.
 *
 * Known limits, also stated in ADR 0007: css-tree is tolerant by design (it
 * recovers instead of failing), it knows nothing about HTML so it cannot see a
 * `</style>` inside a string, and the CSS grammar itself allows some things
 * (balanced braces and unterminated strings at end of input) that the exporter
 * never emits and the hand-written scanner forbids.
 */

export interface ParsedDeclaration {
  name: string
  /** The declaration value regenerated from the parsed AST. */
  value: string
  /** The AST node type of the value ("Value" when custom-property parsing worked, "Raw" when opaque). */
  valueType: string
}

export interface ParsedCss {
  selectors: string[]
  rules: number
  atRules: number
  declarations: ParsedDeclaration[]
  comments: string[]
  parseErrors: string[]
}

export function parseCss(css: string): ParsedCss {
  const parseErrors: string[] = []
  const comments: string[] = []
  const ast = csstree.parse(css, {
    parseCustomProperty: true,
    onParseError: (error) => parseErrors.push(error.message),
    onComment: (value) => comments.push(value),
  })

  const parsed: ParsedCss = {
    selectors: [],
    rules: 0,
    atRules: 0,
    declarations: [],
    comments,
    parseErrors,
  }
  csstree.walk(ast, (node) => {
    if (node.type === 'Rule') {
      parsed.rules++
      parsed.selectors.push(csstree.generate(node.prelude))
    } else if (node.type === 'Atrule') {
      parsed.atRules++
    } else if (node.type === 'Declaration') {
      parsed.declarations.push({
        name: node.property,
        value: csstree.generate(node.value),
        valueType: node.value.type,
      })
    }
  })
  return parsed
}

/** Does `value` match the CSS grammar of `property`? Uses the csstree/mdn-data definitions. */
export function matchesGrammar(property: string, value: string): boolean {
  const parsed = csstree.parse(value, { context: 'value' })
  const match = csstree.lexer.matchProperty(property, parsed)
  return match.error === null || match.error === undefined
}

/** The numeric token types the tokenizer produced for `text`, in order. */
export function tokenKinds(text: string): [string, string][] {
  const names: Record<number, string> = {}
  for (const [name, type] of Object.entries(csstree.tokenTypes)) {
    names[type] = name
  }
  const tokens: [string, string][] = []
  csstree.tokenize(text, (type, start, end) => {
    tokens.push([names[type] ?? String(type), text.slice(start, end)])
  })
  return tokens
}

export interface ExportExpectation {
  /** The one selector the export must have, as css-tree prints it. */
  selector: string
  /** Expected custom property names, in output order. */
  names: string[]
  /** For these properties, the value must also match this real CSS property's grammar. */
  grammar?: Record<string, string>
}

/**
 * Asserts the CSS is exactly one rule with exactly the expected declarations,
 * with no parse errors, no comments and no at-rules.
 */
export function expectCleanExport(css: string, expected: ExportExpectation) {
  const parsed = parseCss(css)
  expect(parsed.parseErrors).toEqual([])
  expect(parsed.comments).toEqual([])
  expect(parsed.atRules).toBe(0)
  expect(parsed.rules).toBe(1)
  expect(parsed.selectors).toEqual([expected.selector])
  expect(parsed.declarations.map((declaration) => declaration.name)).toEqual(
    expected.names,
  )
  for (const declaration of parsed.declarations) {
    const property = expected.grammar?.[declaration.name]
    if (property !== undefined) {
      expect(
        matchesGrammar(property, declaration.value),
        `${declaration.name}: ${declaration.value} should match <${property}>`,
      ).toBe(true)
    }
  }
}
