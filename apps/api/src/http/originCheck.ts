import type { RequestHandler } from 'express'
import { ForbiddenError } from '../errors'

/** Methods that change state. Safe methods are not subject to the checks below. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

/**
 * CSRF defense, layer 2 (with SameSite=Lax cookies and JSON-only bodies): every
 * state-changing request must carry an Origin header that is exactly one of
 * ALLOWED_ORIGINS. A missing header, `null`, a different scheme, a trailing
 * slash or a different case are all refused. Non-browser clients (curl, scripts)
 * must send the header too. An empty allowlist refuses every unsafe request.
 */
export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins)
  return function originCheck(req, _res, next) {
    if (!UNSAFE_METHODS.has(req.method)) {
      next()
      return
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && allowed.has(origin)) {
      next()
      return
    }
    next(new ForbiddenError('Origin not allowed.', 'FORBIDDEN_ORIGIN'))
  }
}
