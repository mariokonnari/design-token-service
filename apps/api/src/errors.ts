/**
 * Typed errors. Each one carries the HTTP status and a stable machine-readable
 * `code`, and the central error handler (src/http/errorHandler.ts) turns them
 * into `{ error: { code, message } }`. None of them may carry tenant data,
 * secrets or internal detail in its message: the message is sent to the client.
 */

export class AppError extends Error {
  readonly status: number
  readonly code: string
  /**
   * Optional machine-readable detail sent to the client as `error.details`
   * (e.g. the issue list of a 400 or the current version of a 409). It must
   * be plain JSON and, like the message, never carry tenant data or secrets.
   * Cross-tenant 404s never have any, so their bodies stay byte-identical.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined
  /** Seconds for a `Retry-After` header (503 only). */
  readonly retryAfterSeconds: number | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The caller's role does not allow this action (403, for an action inside their own organization). */
export class ForbiddenError extends AppError {
  constructor(
    message = 'Your role does not allow this action.',
    code = 'FORBIDDEN',
  ) {
    super(403, code, message)
    this.name = 'ForbiddenError'
  }
}

/** The change collides with existing data, e.g. a slug already in use (409). */
export class ConflictError extends AppError {
  constructor(
    message = 'The request conflicts with existing data.',
    code = 'CONFLICT',
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(409, code, message, details)
    this.name = 'ConflictError'
  }
}

/** The input is not acceptable, detected before touching the database (400). */
export class ValidationError extends AppError {
  constructor(
    message = 'The input is not valid.',
    code = 'VALIDATION_ERROR',
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(400, code, message, details)
    this.name = 'ValidationError'
  }
}

/** No valid session. Deliberately generic: it never says why (401). */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required.', code = 'UNAUTHENTICATED') {
    super(401, code, message)
    this.name = 'UnauthenticatedError'
  }
}

/** Missing, or not visible to the caller. The two are indistinguishable by design (404). */
export class NotFoundError extends AppError {
  constructor(message = 'Not found.', code = 'NOT_FOUND') {
    super(404, code, message)
    this.name = 'NotFoundError'
  }
}

/** A bounded resource (the password-hash queue) is saturated (503). */
export class ServiceBusyError extends AppError {
  constructor(
    message = 'The service is busy. Try again shortly.',
    code = 'SERVICE_BUSY',
    retryAfterSeconds?: number,
  ) {
    super(503, code, message, undefined, retryAfterSeconds)
    this.name = 'ServiceBusyError'
  }
}

/** Too many attempts from this client (429). */
export class RateLimitedError extends AppError {
  constructor(
    message = 'Too many attempts. Try again later.',
    code = 'RATE_LIMITED',
  ) {
    super(429, code, message)
    this.name = 'RateLimitedError'
  }
}

/** The request body is not application/json (415). */
export class UnsupportedMediaTypeError extends AppError {
  constructor(
    message = 'The request body must be application/json.',
    code = 'UNSUPPORTED_MEDIA_TYPE',
  ) {
    super(415, code, message)
    this.name = 'UnsupportedMediaTypeError'
  }
}
