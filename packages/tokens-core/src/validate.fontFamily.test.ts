import { describe, expect, it } from 'vitest'
import { validateLiteral } from './validate'

// fontFamily strings end up inside CSS strings, so validation also rejects
// characters that cannot be written safely there (ADR 0007).

const CONTROL_CHARACTERS = [
  ['NUL', '\u0000'],
  ['TAB', '\u0009'],
  ['LF', '\n'],
  ['CR', '\r'],
  ['FF', '\u000c'],
  ['ESC', '\u001b'],
  ['US', '\u001f'],
  ['DEL', '\u007f'],
] as const

const LONE_SURROGATES = [
  ['a lone high surrogate', '\ud800'],
  ['a lone low surrogate', '\udc00'],
  ['a high surrogate before a non-low one', '\ud800a'],
  ['a low surrogate after text', 'a\udc00b'],
  ['a reversed pair', '\udc00\ud800'],
] as const

function onlyIssue(raw: unknown) {
  const result = validateLiteral('fontFamily', raw, 'p')
  expect(result.ok).toBe(false)
  expect(result.issues).toHaveLength(1)
  return result.issues[0]
}

describe('fontFamily: ASCII control characters', () => {
  it.each(CONTROL_CHARACTERS)('rejects %s in a string', (_name, char) => {
    expect(onlyIssue(`Ari${char}al`)).toMatchObject({
      code: 'INVALID_VALUE',
      severity: 'error',
      path: 'p',
      field: '$value',
    })
  })

  it.each(CONTROL_CHARACTERS)(
    'rejects %s in an array element and names the index',
    (_name, char) => {
      expect(onlyIssue(['Inter', `Ari${char}al`])).toMatchObject({
        code: 'INVALID_VALUE',
        field: '$value[1]',
      })
    },
  )

  it('allows C1 controls, which are not ASCII control characters', () => {
    expect(validateLiteral('fontFamily', 'a\u0085b', 'p').ok).toBe(true)
  })
})

describe('fontFamily: lone surrogates', () => {
  it.each(LONE_SURROGATES)('rejects %s in a string', (_name, text) => {
    expect(onlyIssue(text)).toMatchObject({
      code: 'INVALID_VALUE',
      field: '$value',
    })
  })

  it.each(LONE_SURROGATES)(
    'rejects %s in an array element and names the index',
    (_name, text) => {
      expect(onlyIssue(['Inter', 'Arial', text])).toMatchObject({
        code: 'INVALID_VALUE',
        field: '$value[2]',
      })
    },
  )

  it.each([
    ['non-ASCII text', 'Noto Sans 日本語'],
    ['a valid surrogate pair (emoji)', 'Fun 😀 Font'],
    ['an astral character written directly', '𝒜 Script'],
  ])('accepts %s', (_name, text) => {
    expect(validateLiteral('fontFamily', text, 'p')).toEqual({
      ok: true,
      value: text,
      issues: [],
    })
  })
})
