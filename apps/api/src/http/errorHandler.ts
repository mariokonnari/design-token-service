import type { ErrorRequestHandler, RequestHandler } from 'express'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import { AppError, NotFoundError } from '../errors'

interface HttpFailure {
  status: number
  code: string
  message: string
  details?: Readonly<Record<string, unknown>> | undefined
  retryAfterSeconds?: number | undefined
}

const MAX_ISSUES = 5
const MAX_ISSUE_TEXT = 120

/** Field names and fixed rule texts only; zod never puts the submitted value in a message. */
function describeZod(error: ZodError): string {
  const parts = error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.join('.')
    const text = `${path === '' ? 'body' : path}: ${issue.message}`
    return text.length > MAX_ISSUE_TEXT
      ? `${text.slice(0, MAX_ISSUE_TEXT)}...`
      : text
  })
  return `The request is not valid. ${parts.join('; ')}`
}

/** Errors raised by body-parser / http-errors carry a `type` or an exposed 4xx status. */
function bodyParserFailure(error: unknown): HttpFailure | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const { type, status, expose } = error as {
    type?: unknown
    status?: unknown
    expose?: unknown
  }
  switch (type) {
    case 'entity.too.large':
      return {
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body is too large.',
      }
    case 'entity.parse.failed':
      return {
        status: 400,
        code: 'INVALID_JSON',
        message: 'The request body is not valid JSON.',
      }
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return {
        status: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'The request body must be application/json.',
      }
  }
  if (
    expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    return {
      status,
      code: 'BAD_REQUEST',
      message: 'The request could not be processed.',
    }
  }
  return undefined
}

function toFailure(error: unknown): HttpFailure | undefined {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: describeZod(error),
    }
  }
  return bodyParserFailure(error)
}

/** Reached only when no route matched: the same JSON shape as every other error. */
export const notFoundHandler: RequestHandler = function notFoundHandler(
  _req,
  _res,
  next,
) {
  next(new NotFoundError())
}

/**
 * THE ONE error handler. Every failure leaves the API as
 * `{ error: { code, message } }`: typed errors keep their own status and code,
 * client errors from the body parser and zod are mapped, and anything else is a
 * generic 500. No stack trace or internal detail is ever sent; unknown errors are
 * logged (with the request id) instead.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return function errorHandler(error: unknown, req, res, next) {
    if (res.headersSent) {
      next(error)
      return
    }
    const failure = toFailure(error)
    if (failure === undefined) {
      const log = (req as { log?: Logger }).log ?? logger
      log.error({ err: error }, 'unhandled error')
    }
    const { status, code, message, details, retryAfterSeconds } = failure ?? {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    }
    if (retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(retryAfterSeconds))
    }
    res.status(status).json({
      error:
        details === undefined ? { code, message } : { code, message, details },
    })
  }
}
