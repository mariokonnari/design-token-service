import type { Express, RequestHandler } from 'express'
import type { Role } from '../tenancy/scope'
import type { RouteDef } from './table'

/** The pieces `mountRoutes` needs to build the chain for non-public routes. */
export interface RouteGuards {
  authenticate?: RequestHandler
  requireOrg?: (minimumRole: Role) => RequestHandler
}

function chainFor(route: RouteDef, guards: RouteGuards): RequestHandler[] {
  const where = `${route.method.toUpperCase()} ${route.path}`
  const { access } = route
  const access_: RequestHandler[] = []
  if (access !== 'public') {
    // Fail closed: a protected route can never be mounted without its guard.
    if (guards.authenticate === undefined) {
      throw new Error(
        `${where} needs authentication but no authenticate guard was provided.`,
      )
    }
    access_.push(guards.authenticate)
    if (access !== 'authenticated') {
      if (guards.requireOrg === undefined) {
        throw new Error(
          `${where} needs an organization role but no requireOrg guard was provided.`,
        )
      }
      access_.push(guards.requireOrg(access.orgRole))
    }
  }
  return [...(route.before ?? []), ...access_, ...(route.after ?? [])]
}

/**
 * The ONLY place routes are registered (ESLint forbids app.get/post/... anywhere
 * else). Each route is registered at the top level with its full path so that
 * the guard test can enumerate the Express 5 router reliably.
 */
export function mountRoutes(
  app: Express,
  table: readonly RouteDef[],
  guards: RouteGuards = {},
): void {
  for (const route of table) {
    app[route.method](route.path, ...chainFor(route, guards), route.handler)
  }
}
