import type { RequestHandler } from 'express'
import { UnsupportedMediaTypeError } from '../errors'
import { UNSAFE_METHODS } from './originCheck'

/**
 * CSRF defense, layer 3: a state-changing request that HAS a body must be
 * application/json. A cross-site HTML form can only send form-urlencoded,
 * multipart or text/plain, so this refuses it with 415 before any parsing.
 * A request with no body (e.g. logout, DELETE) needs no content type.
 */
export function requireJsonBody(): RequestHandler {
  return function requireJsonBody(req, _res, next) {
    if (!UNSAFE_METHODS.has(req.method)) {
      next()
      return
    }
    const length = Number(req.headers['content-length'] ?? 0)
    const hasBody =
      (Number.isFinite(length) && length > 0) ||
      req.headers['transfer-encoding'] !== undefined
    if (!hasBody || req.is('application/json')) {
      next()
      return
    }
    next(new UnsupportedMediaTypeError())
  }
}
