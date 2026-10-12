import { useQuery } from '@tanstack/react-query'
import { useApi } from './ApiContext'

/** Query keys. Everything except `me` is dropped when the session ends (auth/me.ts). */
export const ORGS_KEY = ['orgs'] as const
export const brandsKey = (organizationId: string) =>
  ['brands', organizationId] as const
export const brandKey = (organizationId: string, brandId: string) =>
  ['brand', organizationId, brandId] as const

export function useOrganizations() {
  const api = useApi()
  return useQuery({
    queryKey: ORGS_KEY,
    queryFn: ({ signal }) => api.listOrganizations({ signal }),
  })
}

export function useBrands(organizationId: string, enabled: boolean) {
  const api = useApi()
  return useQuery({
    queryKey: brandsKey(organizationId),
    queryFn: ({ signal }) => api.listBrands(organizationId, { signal }),
    enabled,
  })
}

export function useBrand(
  organizationId: string,
  brandId: string,
  enabled: boolean,
) {
  const api = useApi()
  return useQuery({
    queryKey: brandKey(organizationId, brandId),
    queryFn: ({ signal }) => api.getBrand(organizationId, brandId, { signal }),
    enabled,
  })
}
