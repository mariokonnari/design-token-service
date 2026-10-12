import type { Db } from '../db/client'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors'
import { Prisma } from '../generated/prisma/client'
import { isUuid } from '../ids'
import {
  assertCanManageMembers,
  assertCanRemoveMember,
} from '../tenancy/policy'
import { requireScope, type Role, type TenantScope } from '../tenancy/scope'

export interface MemberRecord {
  userId: string
  email: string
  role: Role
  joinedAt: Date
}

const MEMBER_SELECT = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { email: true } },
} as const

interface MemberRow {
  userId: string
  role: Role
  createdAt: Date
  user: { email: string }
}

function toMember(row: MemberRow): MemberRecord {
  return {
    userId: row.userId,
    email: row.user.email,
    role: row.role,
    joinedAt: row.createdAt,
  }
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Members of ONE organization (tenant-scoped).
 *
 * INVARIANT: an organization never ends up with zero OWNERs. Every change that
 * could reduce the owners runs in a transaction that first locks the organization's
 * OWNER rows (`SELECT ... FOR UPDATE`, in id order, so two transactions cannot
 * deadlock), then decides using the LOCKED rows:
 * - the actor's role is re-checked under the lock (a session whose owner was demoted
 *   a moment ago must not act with the role it just lost), and
 * - the last owner can neither be demoted nor removed.
 * Concurrent changes therefore run one after the other, and the second sees the
 * first one's result.
 */
export class MembershipRepository {
  constructor(private readonly db: Db) {}

  async list(scope: TenantScope): Promise<MemberRecord[]> {
    requireScope(scope)
    const rows = await this.db.membership.findMany({
      where: { organizationId: scope.organizationId },
      select: MEMBER_SELECT,
      orderBy: [{ user: { email: 'asc' } }, { userId: 'asc' }],
    })
    return rows.map(toMember)
  }

  async changeRole(
    scope: TenantScope,
    targetUserId: string,
    role: Role,
  ): Promise<MemberRecord> {
    requireScope(scope)
    assertCanManageMembers(scope)
    if (!isUuid(targetUserId)) throw new NotFoundError()

    return this.db.$transaction(
      async (tx) => {
        const owners = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "Membership"
          WHERE "organizationId" = ${scope.organizationId}::uuid AND "role" = 'OWNER'
          ORDER BY "id" FOR UPDATE`

        // Fresh authorization: the locked rows say who is an owner RIGHT NOW.
        if (!owners.some((owner) => sameId(owner.userId, scope.userId))) {
          throw new ForbiddenError('Only an owner can manage members.')
        }

        const target = await tx.membership.findUnique({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId: scope.organizationId,
            },
          },
          select: { role: true },
        })
        if (target === null) throw new NotFoundError()

        const ownersAfter = owners.filter(
          (owner) => !sameId(owner.userId, targetUserId),
        )
        if (
          target.role === 'OWNER' &&
          role !== 'OWNER' &&
          ownersAfter.length === 0
        ) {
          throw new ConflictError(
            'An organization must keep at least one owner.',
            'LAST_OWNER',
          )
        }

        const updated = await tx.membership.update({
          where: {
            userId_organizationId: {
              userId: targetUserId,
              organizationId: scope.organizationId,
            },
          },
          data: { role },
          select: MEMBER_SELECT,
        })
        return toMember(updated)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }

  /** Removes a member. Any member may remove themselves; removing others needs an owner (policy). */
  async remove(scope: TenantScope, targetUserId: string): Promise<void> {
    requireScope(scope)
    assertCanRemoveMember(scope, targetUserId)
    if (!isUuid(targetUserId)) throw new NotFoundError()

    await this.db.$transaction(
      async (tx) => {
        const owners = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "Membership"
          WHERE "organizationId" = ${scope.organizationId}::uuid AND "role" = 'OWNER'
          ORDER BY "id" FOR UPDATE`

        // Removing someone else needs an owner NOW, not merely when the request began.
        const removingSelf = sameId(scope.userId, targetUserId)
        if (
          !removingSelf &&
          !owners.some((owner) => sameId(owner.userId, scope.userId))
        ) {
          throw new ForbiddenError('Only an owner can remove other members.')
        }

        const targetIsOwner = owners.some((owner) =>
          sameId(owner.userId, targetUserId),
        )
        const ownersAfter = owners.filter(
          (owner) => !sameId(owner.userId, targetUserId),
        )
        if (targetIsOwner && ownersAfter.length === 0) {
          throw new ConflictError(
            'An organization must keep at least one owner.',
            'LAST_OWNER',
          )
        }

        const result = await tx.membership.deleteMany({
          where: {
            userId: targetUserId,
            organizationId: scope.organizationId,
          },
        })
        if (result.count === 0) throw new NotFoundError()
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
  }
}
