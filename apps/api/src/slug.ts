import { isValidName } from '@dts/tokens-core'

/**
 * The slug of an organization or a brand: the token-name rule (lowercase letters
 * and digits in hyphen-separated groups) plus a length cap. 63 is the DNS label
 * limit, so a slug could also become a hostname label, and it is short enough for
 * every URL we build from it. The database repeats the cap as a CHECK
 * (`Organization_slug_length`, `Brand_slug_length`); the web app repeats it too.
 * Slugs are ASCII by the name rule, so `length` equals Postgres `char_length`.
 */
export const MAX_SLUG_LENGTH = 63

export function isValidSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && isValidName(value)
}
