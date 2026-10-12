import { Alert } from '@dts/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { useApi } from '../ApiContext'
import type { Organization } from '../api/types'
import { NameSlugForm } from '../components/NameSlugForm'
import { PageHeading } from '../components/PageHeading'
import { Loading, QueryError } from '../components/QueryError'
import { ORGS_KEY, useOrganizations } from '../queries'
import { roleLabel } from '../roles'

export function OrgsPage() {
  const api = useApi()
  const queryClient = useQueryClient()
  const orgs = useOrganizations()
  const [created, setCreated] = useState<string | undefined>()

  return (
    <div className="page">
      <PageHeading title="Organizations" />
      {orgs.isPending ? <Loading>Loading organizations…</Loading> : null}
      {orgs.isError ? (
        <QueryError
          error={orgs.error}
          onRetry={() => {
            void orgs.refetch()
          }}
        />
      ) : null}
      {orgs.isSuccess ? (
        <>
          {orgs.data.length === 0 ? (
            <p>
              You are not a member of any organization yet. Create one below.
            </p>
          ) : (
            <ul className="card-list">
              {orgs.data.map((org) => (
                <li key={org.id}>
                  <Link className="link" to={`/orgs/${org.id}`}>
                    {org.name}
                  </Link>
                  <span className="meta">{org.slug}</span>
                  <span className="meta">{roleLabel(org.role)}</span>
                </li>
              ))}
            </ul>
          )}
          {created === undefined ? null : (
            <Alert variant="success">Created organization “{created}”.</Alert>
          )}
          <NameSlugForm
            idPrefix="org"
            context="createOrg"
            heading="Create an organization"
            submitLabel="Create organization"
            pendingLabel="Creating…"
            create={(input) => api.createOrganization(input)}
            onCreated={(organization: Organization) => {
              queryClient.setQueryData<Organization[]>(ORGS_KEY, (current) =>
                [...(current ?? []), organization].sort((a, b) =>
                  a.slug.localeCompare(b.slug),
                ),
              )
              setCreated(organization.name)
            }}
          />
        </>
      ) : null}
    </div>
  )
}
