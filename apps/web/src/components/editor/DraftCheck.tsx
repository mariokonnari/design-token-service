import { Alert, Button } from '@dts/ui'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId } from 'react'
import { Link, useLocation } from 'react-router'
import { useApi } from '../../ApiContext'
import type { ApiIssue, ValidationReport } from '../../api/types'
import { parseTokenParam } from '../../editor/tokenParam'
import { describeApiError } from '../../forms/describeError'
import { useAnnounce } from '../Announcer'

/** How long after the last successful write the draft is checked on its own. */
export const AUTO_CHECK_DELAY_MS = 1500

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** "publishable", "publishable with 2 warnings" or "1 error, 1 warning". Only the SERVER's answer is ever worded this way. */
export function summarize(report: ValidationReport): string {
  const errors = report.issues.filter((i) => i.severity === 'error').length
  const warnings = report.issues.filter((i) => i.severity === 'warning').length
  if (report.publishable) {
    return warnings === 0
      ? 'publishable'
      : `publishable with ${plural(warnings, 'warning')}`
  }
  return `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`
}

/** A link to a token in this editor, only for a plain token path. The click goes through the discard guard. */
export function TokenLink({
  path,
  onSelect,
}: {
  path: string
  onSelect: (path: string) => void
}) {
  const location = useLocation()
  const param = parseTokenParam(path)
  if (param.kind !== 'path') return <code>{path}</code>
  return (
    <Link
      className="link"
      to={{
        pathname: location.pathname,
        search: new URLSearchParams({ token: param.path }).toString(),
      }}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        onSelect(param.path)
      }}
    >
      {param.path}
    </Link>
  )
}

function IssueItem({
  issue,
  onSelect,
}: {
  issue: ApiIssue
  onSelect: (path: string) => void
}) {
  return (
    <li>
      <strong>{issue.severity === 'error' ? 'Error' : 'Warning'}</strong>
      {issue.path === '' ? null : (
        <>
          {' '}
          <TokenLink path={issue.path} onSelect={onSelect} />
        </>
      )}
      : {issue.message}
    </li>
  )
}

/**
 * "Check draft": GET /validate, shown as a list with a link per token, announced
 * politely. It also runs once, a moment after the last successful write
 * (`autoCheck` counts writes). `revision` is the draft's current revision, so a
 * result for an older one is labelled as such.
 */
export function DraftCheck({
  organizationId,
  brandId,
  revision,
  autoCheck,
  onSelect,
}: {
  organizationId: string
  brandId: string
  revision: number
  autoCheck: number
  onSelect: (path: string) => void
}) {
  const api = useApi()
  const announce = useAnnounce()
  const headingId = useId()
  const check = useMutation({
    mutationFn: () => api.validateDraft(organizationId, brandId),
    onSuccess: (report) => {
      announce(`Draft check: ${summarize(report)}`)
    },
  })
  const { mutate } = check

  useEffect(() => {
    if (autoCheck === 0) return
    const timer = setTimeout(() => {
      mutate()
    }, AUTO_CHECK_DELAY_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [autoCheck, mutate])

  const report = check.data
  return (
    <section aria-labelledby={headingId} className="panel">
      <h2 id={headingId}>Draft check</h2>
      <p className="muted">
        The server checks the whole draft. Only this check says whether it can
        be published.
      </p>
      <div>
        <Button
          variant="secondary"
          disabled={check.isPending}
          onClick={() => {
            mutate()
          }}
        >
          Check draft
        </Button>
      </div>
      {check.isPending ? <p className="muted">Checking…</p> : null}
      {check.isError ? (
        <Alert variant="danger" title="Could not check the draft">
          <p>{describeApiError(check.error, 'load').form}</p>
        </Alert>
      ) : null}
      {report === undefined || check.isPending ? (
        report === undefined && !check.isPending && !check.isError ? (
          <p className="muted">Not checked yet.</p>
        ) : null
      ) : (
        <div>
          <p>Draft check: {summarize(report)}</p>
          <p className="muted">
            Checked at revision {report.draftRevision}
            {report.draftRevision === revision
              ? ''
              : ` (the draft is now at revision ${revision})`}
          </p>
          {report.issues.length === 0 ? null : (
            <ul className="issue-list">
              {report.issues.map((issue, index) => (
                <IssueItem
                  key={`${issue.code}|${issue.path}|${index}`}
                  issue={issue}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
