import { describe, expect, it } from 'vitest'
import { MAX_SLUG_LENGTH, isValidSlug } from '../src/slug'

// The slug rule for organizations and brands: the token-name rule plus a length
// cap (ADR 0014 amendment). 63 is the DNS label limit, so a slug can later be a
// hostname label too.

describe('isValidSlug', () => {
  it('caps slugs at 63 characters', () => {
    expect(MAX_SLUG_LENGTH).toBe(63)
  })

  it('accepts the boundary: 63 characters', () => {
    expect(isValidSlug('a'.repeat(63))).toBe(true)
    expect(isValidSlug(`${'a'.repeat(31)}-${'b'.repeat(31)}`)).toBe(true)
  })

  it('rejects 64 characters', () => {
    expect(isValidSlug('a'.repeat(64))).toBe(false)
    expect(isValidSlug(`${'a'.repeat(32)}-${'b'.repeat(31)}`)).toBe(false)
  })

  it.each(['', 'Acme', 'a_b', '-a', 'a-', 'a--b', 'a b', 'é', 'a/b'])(
    'still applies the name rule: rejects %j',
    (value) => {
      expect(isValidSlug(value)).toBe(false)
    },
  )

  it.each(['acme', 'a', 'a1', 'my-brand', '9-9'])('accepts %j', (value) => {
    expect(isValidSlug(value)).toBe(true)
  })
})
