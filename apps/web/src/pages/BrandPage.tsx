import { Link, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { NotFoundBlock } from '../components/NotFoundBlock'
import { PageHeading } from '../components/PageHeading'
import { Loading, QueryError } from '../components/QueryError'
import { useBrand, useOrganizations } from '../queries'
import { Editor } from '../components/editor/Editor'

const MISSING = 'This brand does not exist, or you cannot see it.'

/** A brand: its breadcrumb and the Theme Editor (ADR 0017). Unknown and foreign brands are the same "not found" page (ADR 0016). */
export function BrandPage() {
  const { orgId = '', brandId = '' } = useParams()
  const orgs = useOrganizations()
  const org = orgs.data?.find((candidate) => candidate.id === orgId)
  const brand = useBrand(orgId, brandId, org !== undefined)

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
    return <NotFoundBlock title="Brand not found">{MISSING}</NotFoundBlock>
  }
  if (brand.isPending) return <Loading>Loading brand…</Loading>
  if (brand.isError) {
    if (brand.error instanceof ApiError && brand.error.status === 404) {
      return <NotFoundBlock title="Brand not found">{MISSING}</NotFoundBlock>
    }
    return (
      <QueryError
        error={brand.error}
        onRetry={() => {
          void brand.refetch()
        }}
      />
    )
  }

  const { data } = brand
  return (
    <div className="page page--wide">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            <Link className="link" to="/">
              Organizations
            </Link>
          </li>
          <li>
            <Link className="link" to={`/orgs/${org.id}`}>
              {org.name}
            </Link>
          </li>
          <li aria-current="page">{data.name}</li>
        </ol>
      </nav>
      <PageHeading title={data.name} />
      <Editor org={org} brand={data} />
    </div>
  )
}
