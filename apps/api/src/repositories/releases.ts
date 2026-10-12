import type { TokenTree } from '@dts/tokens-core'
import type { Db } from '../db/client'
import { busyOrOriginal, isUniqueViolation } from '../db/errors'
import { resolveTxTiming, type TxTiming } from '../db/txTiming'
import { ConflictError, NotFoundError } from '../errors'
import { Prisma } from '../generated/prisma/client'
import { isUuid } from '../ids'
import { buildRelease } from '../releases/build'
import { RELEASE_LIMITS } from '../releases/limits'
import { issueDetails } from '../tokens/issueView'
import { assertCanWrite } from '../tenancy/policy'
import { requireScope, type TenantScope } from '../tenancy/scope'
import { lockBrand } from './tokens'

/**
 * Releases of one brand (ADR 0015): immutable, numbered per brand from 1.
 *
 * This repository exposes NO update and NO delete (a convention test asserts it, and
 * the database refuses both with a trigger). Everything filters by the
 * `organizationId` of the scope, so a release of another organization (or of another
 * brand) is indistinguishable from one that does not exist (404).
 *
 * PUBLISH runs in ONE transaction that
 *   1. locks the brand row (the same lock every draft mutation takes),
 *   2. compares `expectedRevision` with the LOCKED `draftRevision`,
 *   3. only then reads the draft rows (READ COMMITTED: every statement sees what the
 *      writers that held the lock before us committed),
 *   4. validates + builds the release from those rows,
 *   5. refuses a no-op (same revision as the latest release) and a brand at its cap,
 *   6. takes the next number under the lock and inserts.
 * Publishing does NOT change `draftRevision`.
 */

export interface ReleaseMeta {
  number: number
  sourceRevision: number
  note: string | null
  createdAt: Date
  createdById: string
  cssSha256: string
}

export interface ReleaseWithSnapshot extends ReleaseMeta {
  snapshot: TokenTree
}

export interface ReleasePage {
  releases: ReleaseMeta[]
  /** Pass as `before` to get the next (older) page; null on the last page. */
  nextBefore: number | null
}

const META = {
  number: true,
  sourceRevision: true,
  note: true,
  createdAt: true,
  createdById: true,
  cssSha256: true,
} as const

export class ReleaseRepository {
  private readonly timing: TxTiming

  constructor(
    private readonly db: Db,
    timing: Partial<TxTiming> = {},
  ) {
    this.timing = resolveTxTiming(timing)
  }

  async publish(
    scope: TenantScope,
    brandId: string,
    input: { expectedRevision: number; note?: string },
  ): Promise<ReleaseMeta> {
    requireScope(scope)
    assertCanWrite(scope)
    if (!isUuid(brandId)) throw new NotFoundError()

    try {
      return await this.db.$transaction(
        async (tx) => {
          // 1. The brand-row lock: from here on no draft mutation and no other
          //    publish can run for this brand (404 across tenants, 503 on lock timeout).
          const revision = await lockBrand(
            scope,
            tx,
            brandId,
            this.timing.lockTimeoutMs,
          )

          if (input.expectedRevision !== revision) {
            throw new ConflictError(
              'The draft changed since you loaded it.',
              'REVISION_CONFLICT',
              { currentRevision: revision },
            )
          }

          // 3. Only NOW read the draft (and the immutable slug), under the lock.
          const brand = await tx.brand.findFirst({
            where: { id: brandId, organizationId: scope.organizationId },
            select: { slug: true },
          })
          if (brand === null) throw new NotFoundError()
          const rows = await tx.token.findMany({
            where: { brandId, brand: { organizationId: scope.organizationId } },
            select: {
              path: true,
              type: true,
              value: true,
              description: true,
              version: true,
            },
          })
          const built = buildRelease(rows, brand.slug)
          if (!built.ok) {
            throw new ConflictError(
              'The draft cannot be published.',
              'DRAFT_NOT_PUBLISHABLE',
              issueDetails(built.issues),
            )
          }

          const latest = await tx.release.findFirst({
            where: { brandId, brand: { organizationId: scope.organizationId } },
            orderBy: { number: 'desc' },
            select: { number: true, sourceRevision: true },
          })
          if (latest !== null && latest.sourceRevision === revision) {
            throw new ConflictError(
              'Nothing changed since the latest release.',
              'NO_CHANGES',
              { latestReleaseNumber: latest.number },
            )
          }
          const count = await tx.release.count({
            where: { brandId, brand: { organizationId: scope.organizationId } },
          })
          if (count >= RELEASE_LIMITS.MAX_RELEASES_PER_BRAND) {
            throw new ConflictError(
              `A brand may have at most ${RELEASE_LIMITS.MAX_RELEASES_PER_BRAND} releases.`,
              'RELEASE_LIMIT',
              { limit: RELEASE_LIMITS.MAX_RELEASES_PER_BRAND },
            )
          }

          // The latest release has the highest number (numbers only count up).
          const number = (latest?.number ?? 0) + 1
          try {
            return await tx.release.create({
              data: {
                number,
                sourceRevision: revision,
                snapshot: built.snapshot as Prisma.InputJsonValue,
                css: built.css,
                cssSha256: built.cssSha256,
                note: input.note ?? null,
                // connect checks the organization too
                brand: {
                  connect: {
                    id: brandId,
                    organizationId: scope.organizationId,
                  },
                },
                createdBy: { connect: { id: scope.userId } },
              },
              select: META,
            })
          } catch (error) {
            // A backstop that should be unreachable while the brand lock is held.
            if (isUniqueViolation(error)) {
              throw new ConflictError(
                'Another release was published at the same time. Reload and try again.',
                'RELEASE_CONFLICT',
              )
            }
            throw error
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: this.timing.maxWaitMs,
          timeout: this.timing.txTimeoutMs,
        },
      )
    } catch (error) {
      throw busyOrOriginal(error)
    }
  }

  /** Metadata only, newest first. `before` is a release number (exclusive). */
  async list(
    scope: TenantScope,
    brandId: string,
    page: { before?: number; limit: number },
  ): Promise<ReleasePage> {
    requireScope(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    const brand = await this.db.brand.findFirst({
      where: { id: brandId, organizationId: scope.organizationId },
      select: { id: true },
    })
    if (brand === null) throw new NotFoundError()
    const rows = await this.db.release.findMany({
      where: {
        brandId,
        brand: { organizationId: scope.organizationId },
        ...(page.before === undefined ? {} : { number: { lt: page.before } }),
      },
      orderBy: { number: 'desc' },
      take: page.limit + 1,
      select: META,
    })
    const releases = rows.slice(0, page.limit)
    const last = releases[releases.length - 1]
    return {
      releases,
      nextBefore:
        rows.length > page.limit && last !== undefined ? last.number : null,
    }
  }

  /** Metadata + snapshot of one release, or 404 (also for another brand's or organization's number). */
  async get(
    scope: TenantScope,
    brandId: string,
    number: number,
  ): Promise<ReleaseWithSnapshot> {
    requireScope(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    const row = await this.db.release.findFirst({
      where: {
        brandId,
        number,
        brand: { organizationId: scope.organizationId },
      },
      select: { ...META, snapshot: true },
    })
    if (row === null) throw new NotFoundError()
    return { ...row, snapshot: row.snapshot as TokenTree }
  }

  /** The stored CSS of one release and its hash, or 404. */
  async getCss(
    scope: TenantScope,
    brandId: string,
    number: number,
  ): Promise<{ css: string; cssSha256: string }> {
    requireScope(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    const row = await this.db.release.findFirst({
      where: {
        brandId,
        number,
        brand: { organizationId: scope.organizationId },
      },
      select: { css: true, cssSha256: true },
    })
    if (row === null) throw new NotFoundError()
    return row
  }
}
