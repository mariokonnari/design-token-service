import express, { type RequestHandler } from 'express'
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

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g

/**
 * A matcher for the routes that declare their own `bodyLimit`: the method and the
 * path with every `:param` as one segment. Matching is exact and case-sensitive on
 * purpose. If it ever disagrees with Express, it must disagree in the SAFE
 * direction: a path Express still routes (a trailing slash, other letter case) just
 * misses the matcher and gets the small global limit; a path that matches here but
 * not in Express is a 404 whose body was never parsed. Either way no body is read
 * with a bigger limit than its route declared.
 */
function bigBodyMatcher(routes: readonly RouteDef[]) {
  const matchers = routes
    .filter((route) => route.bodyLimit !== undefined)
    .map((route) => {
      const source = route.path
        .split('/')
        .map((segment) =>
          segment.startsWith(':')
            ? '[^/]+'
            : segment.replace(REGEX_SPECIALS, '\\$&'),
        )
        .join('/')
      return {
        method: route.method.toUpperCase(),
        pattern: new RegExp(`^${source}$`),
      }
    })
  return (method: string, path: string) =>
    matchers.some((m) => m.method === method && m.pattern.test(path))
}

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
  const globalJson = express.json({ limit: JSON_BODY_LIMIT })
  const hasOwnBodyLimit = bigBodyMatcher(routes)
  // Named jsonParser so the route guard's expected middleware list is unchanged.
  const jsonParser: RequestHandler = function jsonParser(req, res, next) {
    if (hasOwnBodyLimit(req.method, req.path)) {
      next() // the route parses its own body, after authentication (mountRoutes)
      return
    }
    globalJson(req, res, next)
  }
  app.use(jsonParser)

  mountRoutes(app, routes, guards)

  app.use(notFoundHandler)
  app.use(createErrorHandler(logger))
  return app
}
