import { Alert } from '@dts/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useApi } from '../ApiContext'
import { ApiError } from '../api/client'
import type { Brand } from '../api/types'
import { NameSlugForm } from '../components/NameSlugForm'
import { NotFoundBlock } from '../components/NotFoundBlock'
import { PageHeading } from '../components/PageHeading'
import { Loading, QueryError } from '../components/QueryError'
import { brandsKey, useBrands, useOrganizations } from '../queries'
import { canCreateBrands, roleLabel, visibilityLabel } from '../roles'

const MISSING = 'This organization does not exist, or you are not a member.'

export function BrandsPage() {
  const { orgId = '' } = useParams()
  const api = useApi()
  const queryClient = useQueryClient()
  const orgs = useOrganizations()
  const org = orgs.data?.find((candidate) => candidate.id === orgId)
  // Only ask for the brands of an organization this person is in.
  const brands = useBrands(orgId, org !== undefined)
  const [created, setCreated] = useState<string | undefined>()

  if (orgs.isPending) return <Loading>Loading…</Loading>
  if (orgs.isError) {
    return (
      <QueryError
        error={orgs.error}
        onRetry={() => {
          void orgs.refetch()
        }}
      />
    )
  }
  if (org === undefined) {
    return (
      <NotFoundBlock title="Organization not found">{MISSING}</NotFoundBlock>
    )
  }
  if (brands.isError) {
    if (brands.error instanceof ApiError && brands.error.status === 404) {
      return (
        <NotFoundBlock title="Organization not found">{MISSING}</NotFoundBlock>
      )
    }
    return (
      <QueryError
        error={brands.error}
        onRetry={() => {
          void brands.refetch()
        }}
      />
    )
  }

  return (
    <div className="page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <Link className="link" to="/">
              Organizations
            </Link>
          </li>
          <li aria-current="page">{org.name}</li>
        </ol>
      </nav>
      <PageHeading title={org.name} />
      <p className="muted">
        {org.slug} · Your role: {roleLabel(org.role)}
      </p>
      <h2>Brands</h2>
      {brands.isPending ? <Loading>Loading brands…</Loading> : null}
      {brands.isSuccess ? (
        brands.data.length === 0 ? (
          <p>No brands yet.</p>
        ) : (
          <ul className="card-list">
            {brands.data.map((brand) => (
              <li key={brand.id}>
                <Link
                  className="link"
                  to={`/orgs/${org.id}/brands/${brand.id}`}
                >
                  {brand.name}
                </Link>
                <span className="meta">{brand.slug}</span>
                <span className="meta">
                  {visibilityLabel(brand.visibility)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {created === undefined ? null : (
        <Alert variant="success">Created brand “{created}”.</Alert>
      )}
      {brands.isSuccess ? (
        canCreateBrands(org.role) ? (
          <NameSlugForm
            idPrefix="brand"
            context="createBrand"
            heading="Create a brand"
            submitLabel="Create brand"
            pendingLabel="Creating…"
            create={(input) => api.createBrand(org.id, input)}
            onCreated={(brand: Brand) => {
              queryClient.setQueryData<Brand[]>(brandsKey(org.id), (current) =>
                [...(current ?? []), brand].sort((a, b) =>
                  a.slug.localeCompare(b.slug),
                ),
              )
              setCreated(brand.name)
            }}
          />
        ) : (
          <p>
            You are a viewer in this organization, so you cannot create brands.
          </p>
        )
      ) : null}
    </div>
  )
}
