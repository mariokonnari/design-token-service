/**
 * Reads the API's error envelope, `{ "error": { "code", "message", "details"? } }`
 * (ADR 0013), defensively: anything else (HTML from a proxy, a different JSON
 * shape, wrong types) yields `null` and the caller falls back to a generic error.
 */

export type ApiErrorBodyDetails = Readonly<Record<string, unknown>>

export interface ParsedErrorBody {
  code: string
  message: string
  details: ApiErrorBodyDetails | undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseErrorBody(text: string): ParsedErrorBody | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!isPlainObject(body) || !isPlainObject(body['error'])) return null
  const { code, message, details } = body['error']
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return {
    code,
    message,
    details: isPlainObject(details) ? details : undefined,
  }
}
