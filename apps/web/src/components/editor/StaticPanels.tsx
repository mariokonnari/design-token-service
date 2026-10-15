import { Alert, Button } from '@dts/ui'
import { useId, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import type { Entry, UnreadableRow } from '../../editor/rows'
import { formatTokenValue } from '../../editor/values'
import { DeleteDialog, useDeleteToken } from './DeleteToken'

/** The token has no editor for this person: its facts as text. */
export function ReadOnlyToken({ entry }: { entry: Entry }) {
  const headingId = useId()
  const { token } = entry
  const type = 'alias' in token ? (token.type ?? null) : token.type
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId}>{token.path}</h2>
      <dl className="details">
        <div>
          <dt>Kind</dt>
          <dd>{'alias' in token ? 'Alias' : 'Literal'}</dd>
        </div>
        {type === null ? null : (
          <div>
            <dt>Type</dt>
            <dd>{type}</dd>
          </div>
        )}
        <div>
          <dt>Value</dt>
          <dd>{formatTokenValue(token)}</dd>
        </div>
        {token.description === undefined ? null : (
          <div>
            <dt>Description</dt>
            <dd>{token.description}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/**
 * A stored row that is not a valid token: shown with the reason, never editable. An
 * editor can delete it.
 */
export function UnreadableToken({
  organizationId,
  brandId,
  row,
  canEdit,
  onDeleted,
}: {
  organizationId: string
  brandId: string
  row: UnreadableRow
  canEdit: boolean
  onDeleted: () => void
}) {
  const headingId = useId()
  const del = useDeleteToken({
    organizationId,
    brandId,
    path: row.path,
    version: row.version,
    onDeleted,
  })
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId}>{row.path}</h2>
      <Alert variant="warning" title="This stored value cannot be read">
        <p>{row.message}</p>
        <p>
          It is listed so it does not hide in the draft. It cannot be edited;
          {canEdit ? ' delete it and create the token again.' : ''}
        </p>
      </Alert>
      {del.error === undefined ? null : (
        <Alert variant="danger" title="Could not delete">
          <p>{del.error}</p>
        </Alert>
      )}
      {canEdit ? (
        <>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() => {
                del.setOpen(true)
              }}
            >
              Delete token
            </Button>
          </div>
          <DeleteDialog path={row.path} state={del} />
        </>
      ) : null}
    </section>
  )
}

/** ?token= named something that is not in this draft (or is not a token path at all). Never echoes the value. */
export function TokenNotFound() {
  const headingId = useId()
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        Token not found
      </h2>
      <p>This draft has no token with that path.</p>
      <p>
        <Link className="link" to={{ pathname: location.pathname }}>
          Show all tokens
        </Link>
      </p>
    </section>
  )
}
