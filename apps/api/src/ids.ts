const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * True for a well-formed uuid. Used before a value reaches a uuid column, because
 * Postgres raises an error (not "no rows") for text that is not a uuid, and a
 * malformed id from a URL must be a plain "not found", never a 500.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
