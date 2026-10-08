import { isValidName } from '@dts/tokens-core'
import type { Db } from '../db/client'
import { ConflictError, ValidationError } from '../errors'
import { Prisma, type Brand } from '../generated/prisma/client'
import { isUuid } from '../ids'
import { assertCanWrite } from '../tenancy/policy'
import { requireScope, type TenantScope } from '../tenancy/scope'

export type BrandRecord = Brand

export interface CreateBrandInput {
  /** Lowercase letters, digits and single hyphens, like a token path segment. */
  slug: string
  name: string
}

const MAX_NAME_LENGTH = 200

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

    const name = input.name.trim()
    if (!isValidName(input.slug)) {
      throw new ValidationError(
        'The slug may only contain lowercase letters, digits and single hyphens.',
      )
    }
    if (name === '' || name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(
        `The name must be 1 to ${MAX_NAME_LENGTH} characters.`,
      )
    }

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
}
