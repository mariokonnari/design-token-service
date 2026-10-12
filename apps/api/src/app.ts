import express from 'express'
import helmet from 'helmet'
import type { Logger } from 'pino'
import { createErrorHandler, notFoundHandler } from './http/errorHandler'
import { createHttpLogger } from './http/logger'
import { originCheck } from './http/originCheck'
import { requireJsonBody } from './http/requireJsonBody'
import { mountRoutes, type RouteGuards } from './routes/mount'
import type { RouteDef } from './routes/table'

export interface AppConfig {
  /** Origins allowed to send unsafe (state-changing) requests. */
  allowedOrigins: readonly string[]
  /** Trusted reverse-proxy hops for X-Forwarded-For (0 = none). */
  trustProxy: number
}

export interface AppDeps {
  config: AppConfig
  logger: Logger
  /** The route table; the app mounts routes ONLY from it. */
  routes: readonly RouteDef[]
  guards?: RouteGuards
}

/**
 * The expected middleware stack, by function name. The route guard test compares
 * the mounted app against this, so an `app.use` added anywhere fails the test
 * until it is added here on purpose.
 */
export const APP_MIDDLEWARE = {
  before: [
    'httpLogger',
    'helmetMiddleware',
    'originCheck',
    'requireJsonBody',
    'jsonParser',
  ],
  after: ['notFoundHandler', 'errorHandler'],
} as const

const JSON_BODY_LIMIT = '16kb'

/**
 * Order matters: request id + logging first (so refused requests are logged),
 * security headers, then the cheap refusals (Origin, content type) BEFORE the body
 * is parsed, then the routes, then 404 and the single error handler.
 */
export function createApp({ config, logger, routes, guards }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)

  app.use(createHttpLogger(logger))
  app.use(helmet())
  app.use(originCheck(config.allowedOrigins))
  app.use(requireJsonBody())
  app.use(express.json({ limit: JSON_BODY_LIMIT }))

  mountRoutes(app, routes, guards)

  app.use(notFoundHandler)
  app.use(createErrorHandler(logger))
  return app
}
