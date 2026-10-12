import type { Db } from '../../db/client'
import { isUuid } from '../../ids'
import type { Role } from '../../tenancy/scope'

/**
 * Membership LOOKUPS by user. These are what the auth middleware needs BEFORE a
 * TenantScope exists (it has to find out whether, and as what, the caller belongs
 * to an organization), so they take no scope. Member management inside an
 * organization is tenant-scoped and lives in src/repositories/memberships.ts.
 */

export interface MembershipSummary {
  organizationId: string
  slug: string
  name: string
  role: Role
}

export class MembershipLookupRepository {
  constructor(private readonly db: Db) {}

  /**
   * The caller's role in an organization, or null. "Not a member", "no such
   * organization", "no such user" and a malformed id are all the same answer: null.
   */
  async findMembership(
    userId: string,
    organizationId: string,
  ): Promise<{ role: Role } | null> {
    if (!isUuid(userId) || !isUuid(organizationId)) return null
    return this.db.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    })
  }

  async listForUser(userId: string): Promise<MembershipSummary[]> {
    if (!isUuid(userId)) return []
    const rows = await this.db.membership.findMany({
      where: { userId },
      select: {
        role: true,
        organization: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { organization: { slug: 'asc' } },
    })
    return rows.map((row) => ({
      organizationId: row.organization.id,
      slug: row.organization.slug,
      name: row.organization.name,
      role: row.role,
    }))
  }
}
