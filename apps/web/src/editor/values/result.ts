/** The result of parsing what a person typed: a value, or a sentence saying what is wrong. Never a throw. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

export function good<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

export function bad<T = never>(message: string): Parsed<T> {
  return { ok: false, message }
}

/** Longest text any value editor looks at; anything longer is refused before a pattern touches it. */
export const MAX_INPUT_LENGTH = 2000

/** True for a C0 control, DEL or a C1 control (written as a loop: a pattern with these ranges trips no-control-regex). */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/** Trimmed text, or `undefined` when it is too long or holds a control character. */
export function cleanInput(text: string): string | undefined {
  if (typeof text !== 'string' || text.length > MAX_INPUT_LENGTH) {
    return undefined
  }
  if (hasControlCharacter(text)) return undefined
  return text.trim()
}
