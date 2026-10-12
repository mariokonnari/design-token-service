import { z } from 'zod'
import { NotFoundError } from '../errors'
import { isUuid } from '../ids'

/**
 * Request validation. Every request body is parsed with a STRICT schema (an unknown
 * key is a 400, so a client cannot smuggle `role`, `userId`, `organizationId`, ...
 * into a handler) and every path parameter is validated before it is used. A ZodError
 * is turned into a 400 by the central error handler, which never echoes the values.
 */

/** Parses `value` with `schema`; throws a ZodError (-> 400) on any problem. */
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  return schema.parse(value)
}

/** For routes that take no body: nothing, or an empty object, and nothing else. */
export const emptyBody = z.strictObject({})

export function parseEmptyBody(body: unknown): void {
  parse(emptyBody, body ?? {})
}

/**
 * A path parameter that must be a uuid. Anything else is "not found": a malformed id
 * must look exactly like an id that matches nothing (no 400 vs 404 oracle).
 */
export function uuidOrNotFound(value: unknown): string {
  if (typeof value === 'string' && isUuid(value)) return value
  throw new NotFoundError()
}
