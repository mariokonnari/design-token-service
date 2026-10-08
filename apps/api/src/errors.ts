/**
 * Typed domain errors thrown by the repository and policy layers. The HTTP layer
 * (a later phase) maps them to responses; none of them carries tenant data.
 */

/** The caller's role does not allow this action (HTTP 403 for an action inside their own organization). */
export class ForbiddenError extends Error {
  constructor(message = 'Your role does not allow this action.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** The change collides with existing data, e.g. a slug already in use (HTTP 409). */
export class ConflictError extends Error {
  constructor(message = 'The request conflicts with existing data.') {
    super(message)
    this.name = 'ConflictError'
  }
}

/** The input is not acceptable, detected before touching the database (HTTP 400/422). */
export class ValidationError extends Error {
  constructor(message = 'The input is not valid.') {
    super(message)
    this.name = 'ValidationError'
  }
}
