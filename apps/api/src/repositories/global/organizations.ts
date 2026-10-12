import type { Db } from '../../db/client'
import { ConflictError, ValidationError } from '../../errors'
import { Prisma } from '../../generated/prisma/client'
import { MAX_SLUG_LENGTH, isValidSlug } from '../../slug'

/**
 * Creating an organization happens BEFORE any tenant scope exists (the creator has
 * no membership yet), so it is a global operation.
 */

export interface OrganizationRecord {
  id: string
  slug: string
  name: string
}

const MAX_NAME_LENGTH = 200

export class OrganizationRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates the organization AND its first OWNER membership in ONE transaction
   * (a single nested write): there is never an organization without an owner, and a
   * failure adding the owner leaves nothing behind.
   */
  async createWithOwner(
    userId: string,
    input: { name: string; slug: string },
  ): Promise<OrganizationRecord> {
    const name = input.name.trim()
    if (!isValidSlug(input.slug)) {
      throw new ValidationError(
        `The slug may only contain lowercase letters, digits and single hyphens, and be at most ${MAX_SLUG_LENGTH} characters.`,
        'VALIDATION_ERROR',
        { field: 'slug' },
      )
    }
    if (name === '' || name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(
        `The name must be 1 to ${MAX_NAME_LENGTH} characters.`,
        'VALIDATION_ERROR',
        { field: 'name' },
      )
    }
    try {
      return await this.db.organization.create({
        data: {
          slug: input.slug,
          name,
          memberships: { create: { userId, role: 'OWNER' } },
        },
        select: { id: true, slug: true, name: true },
      })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'An organization with this slug already exists.',
          'SLUG_TAKEN',
        )
      }
      throw error
    }
  }
}
