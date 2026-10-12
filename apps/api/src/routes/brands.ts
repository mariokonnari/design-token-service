import { z } from 'zod'
import { getScope } from '../auth/requireOrg'
import { NotFoundError } from '../errors'
import {
  VISIBILITIES,
  type BrandRecord,
  type BrandRepository,
} from '../repositories/brands'
import type { RouteDef } from './table'
import { parse, uuidOrNotFound } from './validate'

export interface BrandRouteDeps {
  brands: BrandRepository
}

const createBrandBody = z.strictObject({
  name: z.string(),
  slug: z.string(),
})

const updateBrandBody = z
  .strictObject({
    name: z.string().optional(),
    visibility: z.enum(VISIBILITIES).optional(),
  })
  .refine((body) => body.name !== undefined || body.visibility !== undefined, {
    message: 'Send at least one of name or visibility.',
  })

/** The brand as the API shows it: never the organization id. */
export function brandView(brand: BrandRecord) {
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    visibility: brand.visibility,
    draftRevision: brand.draftRevision,
    createdAt: brand.createdAt,
  }
}

/**
 * Brands (ADR 0014). There is NO delete in v1: a brand's releases are RESTRICT,
 * and deleting a brand would cascade away its whole draft, so it needs a design
 * of its own (soft delete, or an explicit purge).
 */
export function brandRoutes({ brands }: BrandRouteDeps): RouteDef[] {
  return [
    {
      method: 'post',
      path: '/api/orgs/:orgId/brands',
      access: { orgRole: 'EDITOR' },
      handler: async (req, res) => {
        const body = parse(createBrandBody, req.body)
        const created = await brands.create(getScope(res), body)
        res.status(201).json({ brand: brandView(created) })
      },
    },

    {
      method: 'get',
      path: '/api/orgs/:orgId/brands',
      access: { orgRole: 'VIEWER' },
      handler: async (_req, res) => {
        const list = await brands.list(getScope(res))
        res.json({ brands: list.map(brandView) })
      },
    },

    {
      method: 'get',
      path: '/api/orgs/:orgId/brands/:brandId',
      access: { orgRole: 'VIEWER' },
      handler: async (req, res) => {
        const brand = await brands.get(
          getScope(res),
          uuidOrNotFound(req.params['brandId']),
        )
        if (brand === null) throw new NotFoundError()
        res.json({ brand: brandView(brand) })
      },
    },

    {
      // Open to editors (rename); `visibility` is narrowed to owners by the policy.
      method: 'patch',
      path: '/api/orgs/:orgId/brands/:brandId',
      access: { orgRole: 'EDITOR' },
      refinedBy: 'canChangeVisibility',
      handler: async (req, res) => {
        const brandId = uuidOrNotFound(req.params['brandId'])
        const body = parse(updateBrandBody, req.body)
        const updated = await brands.update(getScope(res), brandId, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.visibility === undefined
            ? {}
            : { visibility: body.visibility }),
        })
        res.json({ brand: brandView(updated) })
      },
    },
  ]
}
