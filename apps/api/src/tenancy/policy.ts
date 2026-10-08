import { ForbiddenError } from '../errors'
import { requireScope, type Role, type TenantScope } from './scope'

/**
 * The authorization policy, in ONE place. Repositories and services ask these
 * functions; nothing else compares roles. Every function first requires a real,
 * issued scope, so a forged object has no authority at all.
 */

const READ_ROLES: ReadonlySet<Role> = new Set<Role>([
  'OWNER',
  'EDITOR',
  'VIEWER',
])
const WRITE_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'EDITOR'])

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
