import { describe, expect, it } from 'vitest'
import {
  validateLogin,
  validateNameAndSlug,
  validateSignup,
} from '../src/forms/validation'

// Client-side validation is a convenience (earlier feedback); the server is the
// authority and repeats every rule. Each function returns field -> message, and an
// empty object means "valid".

describe('validateNameAndSlug (organizations and brands)', () => {
  const ok = { name: 'Acme', slug: 'acme' }

  it('accepts a valid pair', () => {
    expect(validateNameAndSlug(ok)).toEqual({})
  })

  it.each(['', '   ', '\t\n'])('rejects an empty name %j', (name) => {
    expect(validateNameAndSlug({ ...ok, name }).name).toMatch(/name/i)
  })

  it('counts the TRIMMED name: 200 characters pass, 201 fail', () => {
    expect(
      validateNameAndSlug({ ...ok, name: `  ${'x'.repeat(200)}  ` }),
    ).toEqual({})
    expect(validateNameAndSlug({ ...ok, name: 'x'.repeat(201) }).name).toMatch(
      /200/,
    )
  })

  it.each([
    ['empty', ''],
    ['upper case', 'Acme'],
    ['an underscore', 'a_b'],
    ['a leading hyphen', '-a'],
    ['a trailing hyphen', 'a-'],
    ['a double hyphen', 'a--b'],
    ['a space', 'a b'],
    ['a dot', 'a.b'],
    ['a non-ASCII letter', 'café'],
  ])('rejects a slug with %s', (_label, slug) => {
    expect(validateNameAndSlug({ ...ok, slug }).slug).toBeTypeOf('string')
  })

  it('accepts 63 characters and rejects 64 with a message that names the limit', () => {
    expect(validateNameAndSlug({ ...ok, slug: 'a'.repeat(63) })).toEqual({})
    expect(validateNameAndSlug({ ...ok, slug: 'a'.repeat(64) }).slug).toMatch(
      /63/,
    )
  })

  it('reports both fields at once', () => {
    const errors = validateNameAndSlug({ name: '', slug: 'Bad Slug' })
    expect(Object.keys(errors).sort()).toEqual(['name', 'slug'])
  })
})

describe('validateLogin', () => {
  it('accepts any non-empty email and password (the server decides)', () => {
    expect(validateLogin({ email: 'a@b.c', password: 'x' })).toEqual({})
    // not even the password policy: login must not reveal the rules (ADR 0013)
    expect(validateLogin({ email: 'whatever', password: 'short' })).toEqual({})
  })

  it('requires both', () => {
    const errors = validateLogin({ email: '  ', password: '' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'password'])
  })
})

describe('validateSignup', () => {
  const ok = { email: 'person@example.com', password: 'correct horse battery' }

  it('accepts a valid pair', () => {
    expect(validateSignup(ok)).toEqual({})
  })

  it.each(['', '   ', 'no-at-sign', '@', 'a@', '@b.c', 'a b@c.d'])(
    'rejects the email %j',
    (email) => {
      expect(validateSignup({ ...ok, email }).email).toBeTypeOf('string')
    },
  )

  it('trims the email before checking it', () => {
    expect(validateSignup({ ...ok, email: '  person@example.com  ' })).toEqual(
      {},
    )
  })

  it('requires 12 to 128 characters, counted as code points like the server', () => {
    expect(
      validateSignup({ ...ok, password: 'a'.repeat(11) }).password,
    ).toMatch(/12/)
    expect(validateSignup({ ...ok, password: 'a'.repeat(12) })).toEqual({})
    expect(validateSignup({ ...ok, password: 'a'.repeat(128) })).toEqual({})
    expect(
      validateSignup({ ...ok, password: 'a'.repeat(129) }).password,
    ).toMatch(/128/)
    // 12 emoji are 24 UTF-16 units but 12 code points: valid
    expect(validateSignup({ ...ok, password: '😀'.repeat(12) })).toEqual({})
  })
})
