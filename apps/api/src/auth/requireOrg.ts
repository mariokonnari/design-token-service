import type { RequestHandler, Response } from 'express'
import { NotFoundError } from '../errors'
import { isUuid } from '../ids'
import type { MembershipLookupRepository } from '../repositories/global/memberships'
import { assertAtLeast } from '../tenancy/policy'
import { issueTenantScope, type Role, type TenantScope } from '../tenancy/scope'
import { getAuth } from './authenticate'

export interface RequireOrgDeps {
  memberships: Pick<MembershipLookupRepository, 'findMembership'>
}

/**
 * THE ONLY CALLER OF `issueTenantScope` (ESLint restricts the import to src/auth).
 * It builds the scope from the DATABASE: the organization id from the path and the
 * role from the caller's stored membership, never from anything the client sends.
 *
 * - A malformed id, an organization that does not exist, and an organization the
 *   caller does not belong to are INDISTINGUISHABLE: the same 404 and body (and one
 *   membership lookup each, apart from a malformed id, which needs none).
 * - A member whose role is too low gets 403 (they already know the organization exists).
 */
export function createRequireOrg({ memberships }: RequireOrgDeps) {
  return function requireOrg(minimumRole: Role): RequestHandler {
    return async function requireOrg(req, res, next) {
      try {
        const { userId } = getAuth(res)
        const organizationId = req.params['orgId']
        if (typeof organizationId !== 'string' || !isUuid(organizationId)) {
          throw new NotFoundError()
        }
        const membership = await memberships.findMembership(
          userId,
          organizationId,
        )
        if (membership === null) throw new NotFoundError()

        const scope = issueTenantScope({
          organizationId,
          userId,
          role: membership.role,
        })
        assertAtLeast(scope, minimumRole)
        res.locals['scope'] = scope
        next()
      } catch (error) {
        next(error)
      }
    }
  }
}

/** The caller's scope in the organization of the route. Throws if the route did not run requireOrg. */
export function getScope(res: Response): TenantScope {
  const scope = res.locals['scope'] as TenantScope | undefined
  if (scope === undefined) {
    throw new Error(
      'getScope was called on a route that did not run requireOrg (check its access in the route table).',
    )
  }
  return scope
}
