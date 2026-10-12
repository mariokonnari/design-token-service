/**
 * The canonical form of an email address: trimmed and lowercased. The database
 * stores emails lowercase and enforces it with a CHECK constraint (it rejects a
 * mixed-case value, it does not fix it), so everything that reads or writes an
 * email goes through this first. Idempotent.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
