import { isValidName, type TokenTree } from '@dts/tokens-core'
import type { Db } from '../../db/client'

/**
 * The latest release of a PUBLIC brand, found by slugs (ADR 0015). The only
 * repository that reads tenant-owned data WITHOUT a TenantScope, because the owner made
 * the brand public and the caller is anyone. That makes it the most carefully
 * constrained one (test/repositories/convention.test.ts, `checkPublicRepositorySource`):
 * read operations only, no raw SQL, and EVERY query names `visibility: 'PUBLIC'`.
 *
 * - ONE query walks organization slug -> brand slug (+ PUBLIC) -> newest release, so
 *   there is no check-then-read gap: flipping a brand to PRIVATE takes effect on the
 *   very next request, and a brand that is private, missing, in another organization
 *   or without releases are all just "no row".
 * - The slugs are validated BEFORE any database access: a malformed one never
 *   reaches Postgres.
 * - Nothing here is cached; HTTP caching (ETag, max-age) is the route's business.
 */

export interface PublicRelease {
  number: number
  css: string
  cssSha256: string
  snapshot: TokenTree
}

/** Slugs this long cannot be addressed publicly (the API itself sets no limit on slug length). */
export const MAX_PUBLIC_SLUG_LENGTH = 200

export function isPublicSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PUBLIC_SLUG_LENGTH &&
    isValidName(value)
  )
}

export class PublicReleaseRepository {
  constructor(private readonly db: Db) {}

  /** The newest release of the PUBLIC brand, or null (for every reason alike). */
  async latest(
    organizationSlug: string,
    brandSlug: string,
  ): Promise<PublicRelease | null> {
    if (!isPublicSlug(organizationSlug) || !isPublicSlug(brandSlug)) return null
    const row = await this.db.release.findFirst({
      where: {
        brand: {
          slug: brandSlug,
          visibility: 'PUBLIC',
          organization: { slug: organizationSlug },
        },
      },
      orderBy: { number: 'desc' },
      select: { number: true, css: true, cssSha256: true, snapshot: true },
    })
    return row === null ? null : { ...row, snapshot: row.snapshot as TokenTree }
  }
}
