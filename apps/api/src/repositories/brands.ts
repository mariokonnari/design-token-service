import { isValidName } from '@dts/tokens-core'
import type { Db } from '../db/client'
import { ConflictError, NotFoundError, ValidationError } from '../errors'
import { Prisma, type Brand } from '../generated/prisma/client'
import { isUuid } from '../ids'
import { assertCanChangeVisibility, assertCanWrite } from '../tenancy/policy'
import { requireScope, type TenantScope } from '../tenancy/scope'

export type BrandRecord = Brand

export interface CreateBrandInput {
  /** Lowercase letters, digits and single hyphens, like a token path segment. */
  slug: string
  name: string
}

export const VISIBILITIES = ['PRIVATE', 'PUBLIC'] as const
export type BrandVisibility = (typeof VISIBILITIES)[number]

export interface UpdateBrandInput {
  name?: string
  visibility?: BrandVisibility
}

const MAX_NAME_LENGTH = 200

function cleanName(raw: string): string {
  const name = raw.trim()
  if (name === '' || name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(
      `The name must be 1 to ${MAX_NAME_LENGTH} characters.`,
    )
  }
  return name
}

/**
 * Brands of one organization. Conventions (checked by test/repositories/convention.test.ts):
 * every method takes a TenantScope FIRST, calls requireScope, and puts
 * `organizationId` from the scope into every query. A brand of another
 * organization is indistinguishable from one that does not exist.
 */
export class BrandRepository {
  constructor(private readonly db: Db) {}

  async list(scope: TenantScope): Promise<BrandRecord[]> {
    requireScope(scope)
    return this.db.brand.findMany({
      where: { organizationId: scope.organizationId },
      orderBy: [{ slug: 'asc' }, { id: 'asc' }],
    })
  }

  /** The brand, or null if it does not exist OR belongs to another organization (including a malformed id). */
  async get(scope: TenantScope, id: string): Promise<BrandRecord | null> {
    requireScope(scope)
    // Postgres raises an error for text that is not a uuid; a bad id is just "not found".
    if (!isUuid(id)) return null
    return this.db.brand.findFirst({
      where: { id, organizationId: scope.organizationId },
    })
  }

  async create(
    scope: TenantScope,
    input: CreateBrandInput,
  ): Promise<BrandRecord> {
    requireScope(scope)
    assertCanWrite(scope)

    if (!isValidName(input.slug)) {
      throw new ValidationError(
        'The slug may only contain lowercase letters, digits and single hyphens.',
      )
    }
    const name = cleanName(input.name)

    try {
      return await this.db.brand.create({
        // Only these fields are read from the input: the organization always
        // comes from the scope, never from the caller.
        data: {
          organizationId: scope.organizationId,
          slug: input.slug,
          name,
        },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError('A brand with this slug already exists.')
      }
      throw error
    }
  }

  /**
   * Renames and/or changes visibility. Editors may rename; only an owner may change
   * visibility (policy.canChangeVisibility). The slug is immutable. A brand of
   * another organization (or a malformed id) is a plain 404.
   */
  async update(
    scope: TenantScope,
    id: string,
    input: UpdateBrandInput,
  ): Promise<BrandRecord> {
    requireScope(scope)
    assertCanWrite(scope)
    if (input.visibility !== undefined) assertCanChangeVisibility(scope)
    if (input.name === undefined && input.visibility === undefined) {
      throw new ValidationError('Nothing to change.')
    }
    if (!isUuid(id)) throw new NotFoundError()

    const data: { name?: string; visibility?: BrandVisibility } = {}
    if (input.name !== undefined) data.name = cleanName(input.name)
    if (input.visibility !== undefined) data.visibility = input.visibility

    const result = await this.db.brand.updateMany({
      where: { id, organizationId: scope.organizationId },
      data,
    })
    if (result.count === 0) throw new NotFoundError()
    const brand = await this.get(scope, id)
    if (brand === null) throw new NotFoundError()
    return brand
  }
}
