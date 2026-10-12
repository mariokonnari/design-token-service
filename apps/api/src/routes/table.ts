import type { RequestHandler } from 'express'
import type { Role } from '../tenancy/scope'
import { authRoutes, type AuthRouteDeps } from './auth'
import { healthRoutes, type HealthDeps } from './health'
import { orgRoutes, type OrgRouteDeps } from './orgs'

/**
 * THE ROUTE TABLE: the single source of truth for what the API serves and who
 * may call it (ADR 0013). `createApp` mounts routes ONLY from this table, and a
 * guard test fails if the mounted app has a route that is not listed here.
 *
 * access:
 * - 'public'          anyone, no session needed
 * - 'authenticated'   a valid session
 * - { orgRole: R }    a valid session AND membership of the organization in
 *                     `:orgId` with at least role R (otherwise 404 for
 *                     non-members, 403 for a lower role)
 *
 * `refinedBy` names the tenancy/policy function that NARROWS the declared access
 * inside the handler (e.g. DELETE member is open to any member, but only an OWNER
 * may remove someone else). A route with `refinedBy` needs per-role tests.
 */

export type RouteAccess = 'public' | 'authenticated' | { orgRole: Role }

export interface RouteDef {
  method: 'get' | 'post' | 'patch' | 'delete'
  /** The full path, registered at the top level (no nested routers). */
  path: string
  access: RouteAccess
  handler: RequestHandler
  refinedBy?: string
  /** Runs first, BEFORE authentication (e.g. per-IP rate limiters). */
  before?: readonly RequestHandler[]
  /** Runs after the access checks, before the handler (e.g. a per-user rate limiter). */
  after?: readonly RequestHandler[]
}

export interface RouteTableDeps extends HealthDeps {
  auth?: AuthRouteDeps
  orgs?: OrgRouteDeps
}

export function buildRouteTable({
  auth,
  orgs,
  ...health
}: RouteTableDeps): RouteDef[] {
  return [
    ...healthRoutes(health),
    ...(auth === undefined ? [] : authRoutes(auth)),
    ...(orgs === undefined ? [] : orgRoutes(orgs)),
  ]
}
