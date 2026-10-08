import { isUuid } from '../ids'

/**
 * TenantScope: who is acting and for which organization (ADR 0012). Every
 * repository function takes one as its first parameter and filters by its
 * `organizationId`.
 *
 * The guarantee, in two halves:
 * - COMPILE TIME: the type carries a brand whose symbol is not exported, so code
 *   outside this module cannot write an object literal that satisfies it.
 * - RUN TIME: `issueTenantScope` registers every scope it creates in a private
 *   WeakSet; `requireScope` (called by every repository method) rejects anything
 *   else, including a plain object, a spread copy, a JSON round trip, or a cast.
 *
 * `issueTenantScope` is meant to be called ONLY by the auth middleware, after it
 * has verified the session and looked up the membership (ESLint restricts the
 * import to src/auth/** and tests).
 *
 * Limits: this does not verify that the membership is real (that is the auth
 * middleware's job), and nothing here stops a repository author from writing a
 * query that ignores `scope.organizationId` (tests, the convention test and
 * review do). Within one process, code that really wants to cheat can still
 * reach the WeakSet through the module system only by importing this file and
 * calling issueTenantScope, which is exactly what the lint rule forbids.
 */

export const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const
export type Role = (typeof ROLES)[number]

declare const tenantScopeBrand: unique symbol

export type TenantScope = Readonly<{
  organizationId: string
  userId: string
  role: Role
}> & { readonly [tenantScopeBrand]: true }

const issued = new WeakSet<object>()

export interface TenantScopeInput {
  organizationId: string
  userId: string
  role: Role
}

/** The ONLY way to make a TenantScope. Validates the shape, freezes the result and registers it. */
export function issueTenantScope(input: TenantScopeInput): TenantScope {
  if (!isUuid(input.organizationId)) {
    throw new TypeError('issueTenantScope: organizationId must be a uuid.')
  }
  if (!isUuid(input.userId)) {
    throw new TypeError('issueTenantScope: userId must be a uuid.')
  }
  if (!(ROLES as readonly string[]).includes(input.role)) {
    throw new TypeError(
      'issueTenantScope: role must be OWNER, EDITOR or VIEWER.',
    )
  }
  const scope = Object.freeze({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
  }) as TenantScope
  issued.add(scope)
  return scope
}

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'object' && value !== null && issued.has(value)
}

/** Throws a TypeError unless `scope` was issued by issueTenantScope. Returns it for convenience. */
export function requireScope(scope: TenantScope): TenantScope {
  if (!isTenantScope(scope)) {
    throw new TypeError(
      'A TenantScope issued by issueTenantScope is required (a plain object or a copy is not accepted).',
    )
  }
  return scope
}
