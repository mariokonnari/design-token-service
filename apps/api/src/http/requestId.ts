import { randomUUID } from 'node:crypto'

/** An incoming request id is only accepted in this exact shape. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

/**
 * Picks the id for a request. The incoming X-Request-Id is never used raw: it
 * ends up in a response header and in every log line, so a hostile value
 * (newlines, quotes, huge strings, forged JSON) must not get through. Anything
 * that is not 8 to 64 letters, digits or hyphens is replaced by a fresh uuid.
 */
export function resolveRequestId(incoming: unknown): string {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) {
    return incoming
  }
  return randomUUID()
}
