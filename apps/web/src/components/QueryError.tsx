import { Alert, Button } from '@dts/ui'
import { describeApiError } from '../forms/describeError'

/** A failed read (a list, a page, the session check): a plain message, the request id if it is unexpected, and a retry. */
export function QueryError({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const described = describeApiError(error, 'load')
  return (
    <Alert variant="danger" title="Could not load this">
      <p>{described.form}</p>
      {described.requestId === undefined ? null : (
        <p className="muted">
          Reference: <code>{described.requestId}</code>
        </p>
      )}
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Alert>
  )
}

/** The wait for a list or a page; a polite status, not a spinner. */
export function Loading({ children }: { children: string }) {
  return (
    <p role="status" className="muted">
      {children}
    </p>
  )
}
