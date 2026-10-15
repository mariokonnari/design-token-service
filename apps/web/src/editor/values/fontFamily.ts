import type { FontFamily } from '@dts/tokens-core'
import { bad, cleanInput, good, type Parsed } from './result'

const MESSAGE =
  'Enter font names separated by commas. Put a name in quotes if it contains a comma or a quote.'

/** Characters a name may contain without quotes. Anything else is quoted by the formatter. */
const BARE_SAFE = /^[A-Za-z0-9_-]+(?: [A-Za-z0-9_-]+)*$/

/**
 * Parses a comma list: `Inter, "Helvetica Neue", 'Noto Sans', sans-serif`.
 * A name is bare, or in "double" or 'single' quotes with `\"`, `\'` and `\\` escapes.
 * Empty entries, unbalanced quotes, text after a closing quote, and a quote or a
 * backslash inside a bare name are refused. One name is returned as a string, more
 * as an array.
 */
export function parseFontFamily(text: string): Parsed<FontFamily> {
  const input = cleanInput(text)
  if (input === undefined || input === '') return bad(MESSAGE)

  const names: string[] = []
  let i = 0
  const skipSpaces = () => {
    while (input[i] === ' ') i += 1
  }

  for (;;) {
    skipSpaces()
    const first = input[i]
    if (first === undefined) return bad('A font name is missing.')

    if (first === '"' || first === "'") {
      let name = ''
      i += 1
      let closed = false
      while (i < input.length) {
        const ch = input[i]
        if (ch === '\\') {
          const next = input[i + 1]
          if (next !== '"' && next !== "'" && next !== '\\') {
            return bad(
              'Only \\", \\\' and \\\\ can be escaped with a backslash.',
            )
          }
          name += next
          i += 2
        } else if (ch === first) {
          closed = true
          i += 1
          break
        } else {
          name += ch
          i += 1
        }
      }
      if (!closed) return bad('A quote is not closed.')
      if (name === '') return bad('A font name is empty.')
      names.push(name)
      skipSpaces()
      if (i < input.length && input[i] !== ',') {
        return bad('Put a comma between font names.')
      }
    } else {
      let end = input.indexOf(',', i)
      if (end === -1) end = input.length
      const name = input.slice(i, end).trim()
      if (name === '') return bad('A font name is missing.')
      if (/["'\\]/.test(name)) {
        return bad(
          'Put a name in quotes if it contains a quote or a backslash.',
        )
      }
      names.push(name)
      i = end
    }

    if (i >= input.length) break
    i += 1 // the comma; the loop then requires another name
  }

  const [only] = names
  return good(names.length === 1 && only !== undefined ? only : names)
}

function formatName(name: string): string {
  if (BARE_SAFE.test(name)) return name
  return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function formatFontFamily(value: FontFamily): string {
  return (Array.isArray(value) ? value : [value]).map(formatName).join(', ')
}
