import { Link, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { NotFoundBlock } from '../components/NotFoundBlock'
import { PageHeading } from '../components/PageHeading'
import { Loading, QueryError } from '../components/QueryError'
import { useBrand, useOrganizations } from '../queries'
import { visibilityLabel } from '../roles'

const MISSING = 'This brand does not exist, or you cannot see it.'

/** The place the token editor will go (Phase 4b). For now: the brand and a way back. */
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
    <div className="page">
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
      <p>Token editor coming in 4b. For now this page only shows the brand.</p>
      <dl className="details">
        <div>
          <dt>Slug</dt>
          <dd>{data.slug}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{visibilityLabel(data.visibility)}</dd>
        </div>
        <div>
          <dt>Draft revision</dt>
          <dd>{data.draftRevision}</dd>
        </div>
      </dl>
    </div>
  )
}
