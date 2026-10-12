import { isValidName } from '@dts/tokens-core'
import { describe, expect, it } from 'vitest'
import { MAX_SLUG_LENGTH, suggestSlug } from '../src/forms/slug'

describe('suggestSlug', () => {
  it('uses the same cap as the API (63, ADR 0014 amendment)', () => {
    expect(MAX_SLUG_LENGTH).toBe(63)
  })

  it.each([
    ['Acme Inc', 'acme-inc'],
    ['  Hello,   World!!  ', 'hello-world'],
    ['Café Münch', 'cafe-munch'],
    ['Ünï Çödé 42', 'uni-code-42'],
    ['İstanbul', 'istanbul'],
    ['Straße', 'strasse'],
    ['Øre Æble', 'ore-aeble'],
    ["Bob's Burgers", 'bobs-burgers'],
    ['Bob’s Burgers', 'bobs-burgers'],
    ['foo_bar.baz', 'foo-bar-baz'],
    ['a--b', 'a-b'],
    ['---x---', 'x'],
    ['UPPER lower 9', 'upper-lower-9'],
    ['2024 plan', '2024-plan'],
    ['日本語', ''],
    ['', ''],
    ['   ', ''],
    ['!!!', ''],
  ])('%j -> %j', (name, expected) => {
    expect(suggestSlug(name)).toBe(expected)
  })

  it('cuts to 63 characters', () => {
    expect(suggestSlug('a'.repeat(100))).toBe('a'.repeat(63))
  })

  it('never leaves a trailing hyphen after cutting', () => {
    expect(suggestSlug(`${'a'.repeat(62)} b`)).toBe('a'.repeat(62))
    expect(suggestSlug(`${'a'.repeat(63)} b`)).toBe('a'.repeat(63))
  })

  it('always produces a valid slug or nothing (generated inputs)', () => {
    const pool = [
      ...'abcXYZ019 -_.,;:!?\'"’()[]{}/\\',
      'é',
      'ñ',
      'ü',
      'ß',
      'ø',
      'İ',
      '日',
      '😀',
      '́',
      ' ',
      '\t',
      '\n',
    ]
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed
    }
    for (let i = 0; i < 2000; i++) {
      const length = next() % 90
      let text = ''
      for (let j = 0; j < length; j++) text += pool[next() % pool.length]
      const slug = suggestSlug(text)
      expect(
        slug === '' || (isValidName(slug) && slug.length <= MAX_SLUG_LENGTH),
        JSON.stringify({ text, slug }),
      ).toBe(true)
    }
  })

  it('is idempotent on its own output', () => {
    for (const name of ['Acme Inc', 'Café Münch', 'x'.repeat(80)]) {
      const once = suggestSlug(name)
      expect(suggestSlug(once)).toBe(once)
    }
  })
})
