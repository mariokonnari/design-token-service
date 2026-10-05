import { isValidName } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { isValidThemeSlug } from '../src/ThemeScope/ThemeScope'

// packages/ui/src must not import tokens-core, so ThemeScope carries a copy of
// the name rule. tokens-core's `isValidName` is the source of truth; this test
// fails if the copy drifts.

const ALPHABET = ['a', '0', '-', 'A', '_', '.', ' ', '$']

function* strings(maxLength: number): Generator<string> {
  let layer = ['']
  yield ''
  for (let length = 1; length <= maxLength; length++) {
    layer = layer.flatMap((prefix) => ALPHABET.map((char) => prefix + char))
    yield* layer
  }
}

describe('ThemeScope slug rule stays in sync with tokens-core', () => {
  it('agrees on every string up to length 4 over a tricky alphabet', () => {
    let checked = 0
    let valid = 0
    for (const candidate of strings(4)) {
      checked++
      if (isValidName(candidate)) valid++
      expect(isValidThemeSlug(candidate), JSON.stringify(candidate)).toBe(
        isValidName(candidate),
      )
    }
    expect(checked).toBe(4681)
    expect(valid).toBeGreaterThan(0)
  })

  it.each([
    'default',
    'acme-dark',
    'a--b',
    '-a',
    'a-',
    'é',
    'ab\n',
    'a\u0000',
    '__proto__',
    'constructor',
    '😀',
    'a'.repeat(300),
  ])('agrees on %j', (candidate) => {
    expect(isValidThemeSlug(candidate)).toBe(isValidName(candidate))
  })
})
