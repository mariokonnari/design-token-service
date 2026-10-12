/**
 * Slug rules for organizations and brands. The cap repeats the API's
 * (apps/api/src/slug.ts, ADR 0014 amendment); the character rule is tokens-core's
 * `isValidName`, imported where it is checked (validation.ts).
 */
export const MAX_SLUG_LENGTH = 63

/** Letters that Unicode normalization does not take apart. */
const TRANSLITERATE: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ł: 'l',
}

/**
 * A suggested slug for a name: "Café Münch!" -> "cafe-munch". Accents are removed
 * (NFKD and dropping the combining marks), apostrophes vanish ("Bob's" -> "bobs"),
 * every other run of characters that are not a-z or 0-9 becomes one hyphen, and the
 * result is cut to 63 characters without leaving a trailing hyphen. A name with no
 * Latin letters or digits gives an empty suggestion. The output is always either
 * empty or a valid slug, and suggesting from a suggestion changes nothing.
 */
export function suggestSlug(name: string): string {
  const folded = name
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/['’‘`]/g, '')
    .replaceAll(/[ßæœøđł]/g, (letter) => TRANSLITERATE[letter] ?? letter)
  return folded
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replaceAll(/-+$/g, '')
}
