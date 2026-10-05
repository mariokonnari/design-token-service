/**
 * A deliberately small, hand-written checker for exporter output. It is one of
 * two independent checks used by the security tests (the other is the css-tree
 * parser in cssOracle.ts). Returns a list of violations; empty means clean.
 *
 * It knows the exact shape the exporter promises:
 *
 *   <selector> {
 *     --name: value;
 *   }
 */

const SELECTOR = /^(?::root|\[data-theme="[a-z0-9]+(?:-[a-z0-9]+)*"\]) \{$/
const DECLARATION = /^ {2}(--[a-z0-9]+(?:-[a-z0-9]+)*): (.*);$/

/** Characters that may never appear outside a quoted string in a value. */
const FORBIDDEN_OUTSIDE_STRINGS = '{};<>\\'

function scanValue(value: string, line: number): string[] {
  const problems: string[] = []
  let inString = false

  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i)
    if (inString) {
      if (char === '\\')
        i++ // an escaped character, including \" and \\
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
    } else if (FORBIDDEN_OUTSIDE_STRINGS.includes(char)) {
      problems.push(`line ${line}: "${char}" outside a quoted string`)
    } else if (
      (char === '/' && value.charAt(i + 1) === '*') ||
      (char === '*' && value.charAt(i + 1) === '/')
    ) {
      problems.push(`line ${line}: comment delimiter outside a quoted string`)
    }
  }
  if (inString) problems.push(`line ${line}: unterminated string`)
  return problems
}

export function scanCss(css: string): string[] {
  const problems: string[] = []

  if (css.includes('<')) problems.push('contains "<"')
  if (!css.endsWith('\n')) problems.push('does not end with a newline')

  const lines = css.split('\n')
  lines.pop() // the empty string after the final newline

  if (lines.length < 3) {
    problems.push('expected a selector line, declarations and a closing brace')
    return problems
  }
  if (!SELECTOR.test(lines[0] ?? '')) {
    problems.push('the first line is not exactly the allowed selector and "{"')
  }
  if (lines[lines.length - 1] !== '}') {
    problems.push('the last line is not exactly "}"')
  }

  for (let index = 1; index < lines.length - 1; index++) {
    const line = lines[index] ?? ''
    const match = DECLARATION.exec(line)
    if (match?.[2] === undefined) {
      problems.push(`line ${index + 1}: not exactly one declaration`)
      continue
    }
    problems.push(...scanValue(match[2], index + 1))
  }

  return problems
}
