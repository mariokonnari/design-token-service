import { splitPath, type Token } from '@dts/tokens-core'
import type { Db } from '../db/client'
import { busyOrOriginal } from '../db/errors'
import { resolveTxTiming, type TxTiming } from '../db/txTiming'
import { ConflictError, NotFoundError } from '../errors'
import { Prisma, type Token as TokenRow } from '../generated/prisma/client'
import { isUuid } from '../ids'
import { assertCanWrite } from '../tenancy/policy'
import { requireScope, type TenantScope } from '../tenancy/scope'
import { tokenToRow } from '../tokens/mapper'
import { LIMITS } from '../tokens/validateWrite'

/**
 * The DRAFT tokens of one brand (ADR 0014).
 *
 * EVERY mutation runs in ONE transaction that
 *   1. locks the brand row (`SELECT ... FOR UPDATE`, filtered by the organization),
 *   2. applies the change,
 *   3. increments `Brand.draftRevision` by exactly 1 and returns it.
 * Mutations of one brand therefore run one after the other, and each decides from
 * the state the previous one left. Reads take no lock: they run in one
 * REPEATABLE READ snapshot, so `draftRevision` and the rows always agree.
 *
 * Inside the lock, ONLY the transaction client `tx` is used (never `this.db`):
 * a second connection taken while holding the first could deadlock a small pool.
 *
 * The brand lock, the revision bump and every other query filter by
 * `organizationId` from the scope, so a brand of another organization is
 * indistinguishable from one that does not exist (404).
 */

type Tx = Prisma.TransactionClient

export interface TokenRecord {
  path: string
  type: string | null
  value: unknown
  description: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface DraftSnapshot {
  draftRevision: number
  tokens: TokenRecord[]
}

export interface UpsertResult {
  token: TokenRecord
  created: boolean
  draftRevision: number
}

export interface ReplaceResult {
  count: number
  draftRevision: number
}

const toRecord = (row: TokenRow): TokenRecord => ({
  path: row.path,
  type: row.type,
  value: row.value,
  description: row.description,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/**
 * Step 1: lock the brand row for the rest of the transaction and return its current
 * revision. The first statement also sets `lock_timeout` for this transaction only
 * (SET LOCAL semantics, which also work behind a transaction pooler) and doubles as
 * an organization-filtered existence check; the second takes the lock. A brand of
 * another organization, or no brand, is a plain 404 before anything is locked.
 */
export async function lockBrand(
  scope: TenantScope,
  tx: Tx,
  brandId: string,
  lockTimeoutMs: number,
): Promise<number> {
  requireScope(scope)
  const found = await tx.$queryRaw<{ timeout: string }[]>`
    SELECT set_config('lock_timeout', ${`${lockTimeoutMs}ms`}, true) AS "timeout"
    FROM "Brand"
    WHERE "id" = ${brandId}::uuid AND "organizationId" = ${scope.organizationId}::uuid`
  if (found.length === 0) throw new NotFoundError()

  const locked = await tx.$queryRaw<{ draftRevision: number }[]>`
    SELECT "draftRevision" FROM "Brand"
    WHERE "id" = ${brandId}::uuid AND "organizationId" = ${scope.organizationId}::uuid
    FOR UPDATE`
  const row = locked[0]
  if (row === undefined) throw new NotFoundError()
  return row.draftRevision
}

/** Step 3: bump `draftRevision` by exactly 1 (the brand row is locked) and return it. */
export async function bumpRevision(
  scope: TenantScope,
  tx: Tx,
  brandId: string,
): Promise<number> {
  requireScope(scope)
  const bumped = await tx.$queryRaw<{ draftRevision: number }[]>`
    UPDATE "Brand" SET "draftRevision" = "draftRevision" + 1
    WHERE "id" = ${brandId}::uuid AND "organizationId" = ${scope.organizationId}::uuid
    RETURNING "draftRevision"`
  const row = bumped[0]
  if (row === undefined) throw new NotFoundError()
  return row.draftRevision
}

export class TokenRepository {
  private readonly timing: TxTiming

  constructor(
    private readonly db: Db,
    timing: Partial<TxTiming> = {},
  ) {
    this.timing = resolveTxTiming(timing)
  }

  /** The draft and its revision from ONE snapshot. No lock. */
  async read(scope: TenantScope, brandId: string): Promise<DraftSnapshot> {
    requireScope(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    try {
      return await this.db.$transaction(
        async (tx) => {
          const brand = await tx.brand.findFirst({
            where: { id: brandId, organizationId: scope.organizationId },
            select: { draftRevision: true },
          })
          if (brand === null) throw new NotFoundError()
          const rows = await tx.token.findMany({
            where: {
              brandId,
              brand: { organizationId: scope.organizationId },
            },
          })
          return {
            draftRevision: brand.draftRevision,
            tokens: rows.map(toRecord),
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: this.timing.maxWaitMs,
          timeout: this.timing.txTimeoutMs,
        },
      )
    } catch (error) {
      throw busyOrOriginal(error)
    }
  }

  /**
   * Creates or updates ONE token (already validated by tokens-core).
   * - exists: `expectedVersion` is required and must equal the current version;
   * - missing: `expectedVersion` must be absent, and the path must not be a token
   *   and a group at once, and the brand must have room (2000 tokens).
   * The version increments on every update (no no-op detection).
   */
  async upsert(
    scope: TenantScope,
    brandId: string,
    input: { token: Token; expectedVersion?: number },
  ): Promise<UpsertResult> {
    requireScope(scope)
    assertCanWrite(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    const row = tokenToRow(input.token)

    return this.mutate(scope, brandId, async (tx) => {
      const existing = await tx.token.findFirst({
        where: {
          brandId,
          path: row.path,
          brand: { organizationId: scope.organizationId },
        },
      })

      if (existing !== null) {
        if (input.expectedVersion === undefined) {
          throw new ConflictError(
            'This token already exists; send expectedVersion to update it.',
            'VERSION_REQUIRED',
            { currentVersion: existing.version },
          )
        }
        if (input.expectedVersion !== existing.version) {
          throw new ConflictError(
            'The token changed since you loaded it.',
            'VERSION_CONFLICT',
            { currentVersion: existing.version },
          )
        }
        const updated = await tx.token.updateMany({
          where: {
            id: existing.id,
            brandId,
            brand: { organizationId: scope.organizationId },
          },
          data: {
            type: row.type,
            value: row.value as Prisma.InputJsonValue,
            description: row.description,
            version: { increment: 1 },
          },
        })
        if (updated.count !== 1) throw new NotFoundError()
        const fresh = await tx.token.findFirst({
          where: {
            id: existing.id,
            brandId,
            brand: { organizationId: scope.organizationId },
          },
        })
        if (fresh === null) throw new NotFoundError()
        return { token: toRecord(fresh), created: false }
      }

      if (input.expectedVersion !== undefined) {
        throw new ConflictError(
          'There is no token at this path to update.',
          'VERSION_CONFLICT',
          { currentVersion: null },
        )
      }

      // A path cannot be both a token and a group (a vs a.b).
      const segments = splitPath(row.path)
      const ancestors = segments
        .slice(0, -1)
        .map((_, index) => segments.slice(0, index + 1).join('.'))
      const clash = await tx.token.findFirst({
        where: {
          brandId,
          brand: { organizationId: scope.organizationId },
          OR: [
            { path: { in: ancestors } },
            { path: { startsWith: `${row.path}.` } },
          ],
        },
        select: { path: true },
      })
      if (clash !== null) {
        throw new ConflictError(
          clash.path.length < row.path.length
            ? `"${clash.path}" is a token, so "${row.path}" cannot be nested under it.`
            : `"${row.path}" is a group (it contains "${clash.path}"), so it cannot also be a token.`,
          'PATH_CONFLICT',
          { conflictsWith: clash.path },
        )
      }

      const count = await tx.token.count({
        where: { brandId, brand: { organizationId: scope.organizationId } },
      })
      if (count >= LIMITS.MAX_TOKENS_PER_BRAND) {
        throw new ConflictError(
          `A brand may have at most ${LIMITS.MAX_TOKENS_PER_BRAND} tokens.`,
          'TOKEN_LIMIT',
        )
      }

      try {
        const created = await tx.token.create({
          data: {
            path: row.path,
            type: row.type,
            value: row.value as Prisma.InputJsonValue,
            description: row.description,
            // connect checks the organization too: a brand of another one cannot be hit.
            brand: {
              connect: { id: brandId, organizationId: scope.organizationId },
            },
          },
        })
        return { token: toRecord(created), created: true }
      } catch (error) {
        // Unreachable while the brand lock is held; if it ever happens, it is a
        // conflict the editor can refetch from, never a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictError(
            'This token already exists; send expectedVersion to update it.',
            'VERSION_REQUIRED',
          )
        }
        throw error
      }
    })
  }

  /** Deletes ONE token; `expectedVersion` must match. Aliases pointing at it are not blocked. */
  async remove(
    scope: TenantScope,
    brandId: string,
    path: string,
    expectedVersion: number,
  ): Promise<{ draftRevision: number }> {
    requireScope(scope)
    assertCanWrite(scope)
    if (!isUuid(brandId)) throw new NotFoundError()

    const { draftRevision } = await this.mutate(scope, brandId, async (tx) => {
      const existing = await tx.token.findFirst({
        where: {
          brandId,
          path,
          brand: { organizationId: scope.organizationId },
        },
      })
      if (existing === null) throw new NotFoundError()
      if (existing.version !== expectedVersion) {
        throw new ConflictError(
          'The token changed since you loaded it.',
          'VERSION_CONFLICT',
          { currentVersion: existing.version },
        )
      }
      const removed = await tx.token.deleteMany({
        where: {
          id: existing.id,
          brandId,
          brand: { organizationId: scope.organizationId },
        },
      })
      if (removed.count !== 1) throw new NotFoundError()
      return {}
    })
    return { draftRevision }
  }

  /**
   * Replaces the WHOLE draft with `tokens` (already validated, at most 2000, distinct
   * paths) if the brand is still at `expectedRevision`. One transaction: either the
   * old draft or the new one, never a mix.
   */
  async replaceAll(
    scope: TenantScope,
    brandId: string,
    tokens: readonly Token[],
    expectedRevision: number,
  ): Promise<ReplaceResult> {
    requireScope(scope)
    assertCanWrite(scope)
    if (!isUuid(brandId)) throw new NotFoundError()
    if (tokens.length > LIMITS.MAX_TOKENS_PER_BRAND) {
      throw new ConflictError(
        `A brand may have at most ${LIMITS.MAX_TOKENS_PER_BRAND} tokens.`,
        'TOKEN_LIMIT',
      )
    }
    const rows = tokens.map(tokenToRow)

    const { draftRevision } = await this.mutate(
      scope,
      brandId,
      async (tx, revision) => {
        if (revision !== expectedRevision) {
          throw new ConflictError(
            'The draft changed since you loaded it.',
            'REVISION_CONFLICT',
            { currentRevision: revision },
          )
        }
        // A path that survives the import keeps counting UP (old version + 1), so an
        // editor holding the old version can never match the replaced token (the
        // version must not go back to 1: that would be an ABA hole). New paths start at 1.
        const previous = await tx.token.findMany({
          where: { brandId, brand: { organizationId: scope.organizationId } },
          select: { path: true, version: true },
        })
        const versions = new Map(previous.map((p) => [p.path, p.version]))
        const payload = rows.map((r) => ({
          ...r,
          version: (versions.get(r.path) ?? 0) + 1,
        }))
        await tx.token.deleteMany({
          where: { brandId, brand: { organizationId: scope.organizationId } },
        })
        if (payload.length > 0) {
          // One statement; the brand is re-checked against the organization.
          await tx.$executeRaw`
            INSERT INTO "Token" ("brandId", "path", "type", "value", "description", "version")
            SELECT b."id", t."path", t."type", t."value", t."description", t."version"
            FROM "Brand" b,
              jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
                AS t("path" text, "type" text, "value" jsonb, "description" text, "version" int)
            WHERE b."id" = ${brandId}::uuid
              AND b."organizationId" = ${scope.organizationId}::uuid`
        }
        return {}
      },
    )
    return { count: rows.length, draftRevision }
  }

  /**
   * The lock -> change -> bump transaction every mutation goes through, so none can
   * forget the lock or the revision. A failure of any step rolls everything back, so
   * a rejected change never moves `draftRevision`.
   */
  private async mutate<T extends object>(
    scope: TenantScope,
    brandId: string,
    change: (tx: Tx, revision: number) => Promise<T>,
  ): Promise<T & { draftRevision: number }> {
    try {
      return await this.db.$transaction(
        async (tx) => {
          const revision = await lockBrand(
            scope,
            tx,
            brandId,
            this.timing.lockTimeoutMs,
          )
          const result = await change(tx, revision)
          const draftRevision = await bumpRevision(scope, tx, brandId)
          return { ...result, draftRevision }
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
}
