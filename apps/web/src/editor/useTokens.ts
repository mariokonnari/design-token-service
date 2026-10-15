import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../ApiContext'
import type { Brand, TokenList } from '../api/types'
import { brandKey } from '../queries'
import { readTokenList } from './rows'

/** Everything except `me` is dropped when the session ends (auth/me.ts), and this key starts with `tokens`. */
export const tokensKey = (organizationId: string, brandId: string) =>
  ['tokens', organizationId, brandId] as const

function selectList(list: TokenList) {
  return { draftRevision: list.draftRevision, ...readTokenList(list.tokens) }
}

/** The draft tokens of a brand: readable entries with versions, unreadable rows, and the revision. */
export function useTokenList(organizationId: string, brandId: string) {
  const api = useApi()
  return useQuery({
    queryKey: tokensKey(organizationId, brandId),
    queryFn: ({ signal }) =>
      api.listTokens(organizationId, brandId, { signal }),
    select: selectList,
  })
}

/** Cache writers: the list from a write's answer, the revision shown on the brand, and a forced reload. */
export function useTokenCache(organizationId: string, brandId: string) {
  const queryClient = useQueryClient()

  const update = useCallback(
    (change: (list: TokenList) => TokenList, draftRevision: number) => {
      queryClient.setQueryData<TokenList>(
        tokensKey(organizationId, brandId),
        (old) => (old === undefined ? old : change(old)),
      )
      queryClient.setQueryData<Brand>(
        brandKey(organizationId, brandId),
        (old) => (old === undefined ? old : { ...old, draftRevision }),
      )
    },
    [queryClient, organizationId, brandId],
  )

  /** Only the revision shown on the brand (after an import). */
  const setRevision = useCallback(
    (draftRevision: number) => {
      queryClient.setQueryData<Brand>(
        brandKey(organizationId, brandId),
        (old) => (old === undefined ? old : { ...old, draftRevision }),
      )
    },
    [queryClient, organizationId, brandId],
  )

  /** Reloads the list from the server and returns it (undefined if the reload failed). */
  const reload = useCallback(async () => {
    const key = tokensKey(organizationId, brandId)
    await queryClient.refetchQueries({ queryKey: key, exact: true })
    return queryClient.getQueryData<TokenList>(key)
  }, [queryClient, organizationId, brandId])

  return { update, reload, setRevision }
}
