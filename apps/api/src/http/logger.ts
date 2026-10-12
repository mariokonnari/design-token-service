import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RequestHandler } from 'express'
import { pino, type DestinationStream, type Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import { resolveRequestId } from './requestId'

/**
 * Logging. Secrets are kept out of the logs in two independent layers:
 * 1. an ALLOWLIST serializer: only a few harmless request fields are logged at all
 *    (never headers such as cookie or authorization, never the body, never the
 *    query string, and never the raw X-Request-Id);
 * 2. pino `redact` for the same names, in case a handler logs an object that holds them.
 */

export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
]

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
    },
    options.destination,
  )
}

const MAX_USER_AGENT = 200

interface SerializedRequest {
  id?: unknown
  method?: unknown
  url?: unknown
  remoteAddress?: unknown
  headers?: Record<string, unknown>
}

export function createHttpLogger(logger: Logger): RequestHandler {
  const inner = pinoHttp({
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const id = resolveRequestId(req.headers['x-request-id'])
      res.setHeader('X-Request-Id', id)
      return id
    },
    serializers: {
      req: (req: SerializedRequest) => {
        const userAgent = req.headers?.['user-agent']
        return {
          id: req.id,
          method: req.method,
          // The path only: a query string can carry tokens.
          url: typeof req.url === 'string' ? (req.url.split('?')[0] ?? '') : '',
          remoteAddress: req.remoteAddress,
          userAgent:
            typeof userAgent === 'string'
              ? userAgent.slice(0, MAX_USER_AGENT)
              : undefined,
        }
      },
      res: (res: { statusCode?: unknown }) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
    // The probes are polled constantly; logging them would drown the log.
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/ready',
    },
  })
  // Named, so the route guard test can recognize it in the middleware stack.
  return function httpLogger(req, res, next) {
    inner(req, res, next)
  }
}
