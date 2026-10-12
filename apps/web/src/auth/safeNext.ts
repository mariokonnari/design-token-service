/**
 * The "where to go after signing in" value, from `/login?next=...` (ADR 0016).
 *
 * `next` is attacker-controlled: anyone can send a link such as
 * `/login?next=//evil.com`. Navigating to it would take a freshly signed-in user
 * to another site, so only a plain same-origin PATH is accepted, everything else
 * becomes the fallback. The rules are deliberately stricter than "is it safe":
 *
 * - printable ASCII only (no spaces, controls, Unicode look-alikes, line breaks);
 * - starts with exactly one `/`, so never `//host` (protocol-relative) and never a
 *   scheme (`https:`, `javascript:`, `data:`);
 * - no backslash anywhere (browsers treat `/\host` like `//host`);
 * - the PERCENT-DECODED form must pass the same rules, so `/%2F%2Fevil.com` and
 *   `/%5Cevil.com` cannot sneak through a later decode;
 * - at most 512 characters;
 * - not /login or /signup (a redirect loop);
 * - and a final check with the URL parser that it stays on the same origin.
 */

const MAX_LENGTH = 512
const PRINTABLE_ASCII = /^[!-~]+$/
// C0, DEL, C1 and the Unicode line/paragraph separators (U+2028, U+2029), after
// decoding. Built from code points so the source has no invisible characters.
const CONTROL = new RegExp(
  String.raw`[\x00-\x1f\x7f-\x9f${String.fromCodePoint(0x2028)}${String.fromCodePoint(0x2029)}]`,
)
const AUTH_PAGE = /^\/(?:login|signup)(?:[/?#]|$)/i
const PROBE_ORIGIN = 'http://dts.invalid'

export function isSafeNext(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_LENGTH) return false
  if (!PRINTABLE_ASCII.test(value) || value.includes('\\')) return false
  if (!value.startsWith('/') || value.startsWith('//')) return false

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (
    decoded.startsWith('//') ||
    decoded.includes('\\') ||
    CONTROL.test(decoded)
  ) {
    return false
  }
  if (AUTH_PAGE.test(value) || AUTH_PAGE.test(decoded)) return false

  try {
    const url = new URL(value, PROBE_ORIGIN)
    return url.origin === PROBE_ORIGIN
  } catch {
    return false
  }
}

/** `raw` if it is a safe same-origin path, otherwise `fallback`. */
export function safeNext(raw: unknown, fallback = '/'): string {
  return isSafeNext(raw) ? raw : fallback
}

/** Where to send a visitor who needs to sign in: /login, remembering the page they wanted. */
export function loginPathFor(wanted: {
  pathname: string
  search: string
}): string {
  const target = wanted.pathname + wanted.search
  if (target === '/' || !isSafeNext(target)) return '/login'
  return `/login?next=${encodeURIComponent(target)}`
}
