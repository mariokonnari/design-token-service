/**
 * Typed errors. Each one carries the HTTP status and a stable machine-readable
 * `code`, and the central error handler (src/http/errorHandler.ts) turns them
 * into `{ error: { code, message } }`. None of them may carry tenant data,
 * secrets or internal detail in its message: the message is sent to the client.
 */

export class AppError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
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
  ) {
    super(409, code, message)
    this.name = 'ConflictError'
  }
}

/** The input is not acceptable, detected before touching the database (400). */
export class ValidationError extends AppError {
  constructor(message = 'The input is not valid.', code = 'VALIDATION_ERROR') {
    super(400, code, message)
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
  ) {
    super(503, code, message)
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
