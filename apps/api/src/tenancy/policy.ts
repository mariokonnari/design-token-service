import { ForbiddenError } from '../errors'
import { requireScope, type Role, type TenantScope } from './scope'

/**
 * The authorization policy, in ONE place. Repositories, routes and guards ask these
 * functions; nothing else compares roles. Every function first requires a real,
 * issued scope, so a forged object has no authority at all.
 */

const READ_ROLES: ReadonlySet<Role> = new Set<Role>([
  'OWNER',
  'EDITOR',
  'VIEWER',
])
const WRITE_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'EDITOR'])

/** VIEWER < EDITOR < OWNER. */
const RANK: Readonly<Record<Role, number>> = { VIEWER: 0, EDITOR: 1, OWNER: 2 }

export function canRead(scope: TenantScope): boolean {
  return READ_ROLES.has(requireScope(scope).role)
}

export function canWrite(scope: TenantScope): boolean {
  return WRITE_ROLES.has(requireScope(scope).role)
}

/** Throws ForbiddenError unless the role may change data inside its own organization. */
export function assertCanWrite(scope: TenantScope): void {
  if (!canWrite(scope)) {
    throw new ForbiddenError('Your role does not allow changes.')
  }
}

export function hasRoleAtLeast(scope: TenantScope, minimum: Role): boolean {
  return RANK[requireScope(scope).role] >= RANK[minimum]
}

/** The check behind a route's declared `orgRole`: 403 for a lower role in your own organization. */
export function assertAtLeast(scope: TenantScope, minimum: Role): void {
  if (!hasRoleAtLeast(scope, minimum)) {
    throw new ForbiddenError('Your role does not allow this action.')
  }
}

/** Changing roles and removing OTHER members: owners only. */
export function canManageMembers(scope: TenantScope): boolean {
  return hasRoleAtLeast(scope, 'OWNER')
}

export function assertCanManageMembers(scope: TenantScope): void {
  if (!canManageMembers(scope)) {
    throw new ForbiddenError('Only an owner can manage members.')
  }
}

/**
 * Changing a brand's visibility (private/public) is an owner decision; an editor may
 * still rename it. This is the policy `refinedBy` names on PATCH brand: the route is
 * open to editors and this narrows the `visibility` field.
 */
export function canChangeVisibility(scope: TenantScope): boolean {
  return hasRoleAtLeast(scope, 'OWNER')
}

export function assertCanChangeVisibility(scope: TenantScope): void {
  if (!canChangeVisibility(scope)) {
    throw new ForbiddenError('Only an owner can change a brand’s visibility.')
  }
}

/**
 * Any member may remove THEMSELVES (leave); removing someone else needs an owner.
 * This is the policy `refinedBy` names on the DELETE member route: the route is open
 * to every member and this narrows it.
 */
export function canRemoveMember(
  scope: TenantScope,
  targetUserId: string,
): boolean {
  requireScope(scope)
  return (
    scope.userId.toLowerCase() === targetUserId.toLowerCase() ||
    canManageMembers(scope)
  )
}

export function assertCanRemoveMember(
  scope: TenantScope,
  targetUserId: string,
): void {
  if (!canRemoveMember(scope, targetUserId)) {
    throw new ForbiddenError('Only an owner can remove other members.')
  }
}
