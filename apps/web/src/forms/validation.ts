import { isValidName } from '@dts/tokens-core'
import { MAX_SLUG_LENGTH } from './slug'

/**
 * Client-side validation: earlier feedback, not security. The server repeats every
 * rule and is the authority (a 400 is mapped back to a field, describeError.ts).
 * Each function returns field -> message; an empty object means valid.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>

export const MAX_NAME_LENGTH = 200
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128

// Something@something.tld: no spaces, one @, a dot in the domain. The API's own
// check is stricter; this only catches typos early.
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

/** Length in code points, like the server (an emoji is one character). */
function characters(text: string): number {
  return [...text].length
}

export function validateNameAndSlug(input: {
  name: string
  slug: string
}): FieldErrors<'name' | 'slug'> {
  const errors: FieldErrors<'name' | 'slug'> = {}
  const name = input.name.trim()
  if (name === '') {
    errors.name = 'Enter a name.'
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `The name must be at most ${MAX_NAME_LENGTH} characters.`
  }

  if (input.slug === '') {
    errors.slug = 'Enter a slug.'
  } else if (input.slug.length > MAX_SLUG_LENGTH) {
    errors.slug = `The slug must be at most ${MAX_SLUG_LENGTH} characters.`
  } else if (!isValidName(input.slug)) {
    errors.slug =
      'Use lowercase letters and digits, separated by single hyphens (for example acme-labs).'
  }
  return errors
}

/** Login checks presence only: it must not reveal the password rules (ADR 0013). */
export function validateLogin(input: {
  email: string
  password: string
}): FieldErrors<'email' | 'password'> {
  const errors: FieldErrors<'email' | 'password'> = {}
  if (input.email.trim() === '') errors.email = 'Enter your email address.'
  if (input.password === '') errors.password = 'Enter your password.'
  return errors
}

export function validateSignup(input: {
  email: string
  password: string
}): FieldErrors<'email' | 'password'> {
  const errors: FieldErrors<'email' | 'password'> = {}
  const email = input.email.trim()
  if (email === '') {
    errors.email = 'Enter your email address.'
  } else if (!EMAIL.test(email)) {
    errors.email = 'Enter a valid email address, like name@example.com.'
  }

  const length = characters(input.password)
  if (length < MIN_PASSWORD_LENGTH) {
    errors.password = `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  } else if (length > MAX_PASSWORD_LENGTH) {
    errors.password = `The password must be at most ${MAX_PASSWORD_LENGTH} characters.`
  }
  return errors
}
