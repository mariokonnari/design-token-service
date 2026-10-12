import { Alert } from '@dts/ui'
import type { Ref } from 'react'
import type { SummaryItem } from '../forms/useSubmitForm'

/**
 * The error summary shown at the top of a form after a failed submit: a danger
 * Alert (role="alert") that is mounted in response to the submit, which is when
 * assistive technology reads it, and that takes keyboard focus. Each message links
 * to its field. A link focuses the input without navigating (a hash link would
 * change the router's location). Everything is rendered as React text.
 */
export function FormErrorSummary({
  attach,
  items,
  message,
  requestId,
}: {
  /** Gives the parent the element (a callback ref) so it can move focus there. */
  attach: Ref<HTMLDivElement>
  items: readonly SummaryItem[]
  message?: string | undefined
  requestId?: string | undefined
}) {
  return (
    <Alert
      ref={attach}
      tabIndex={-1}
      variant="danger"
      title="There is a problem"
      className="form-summary"
    >
      {message === undefined ? null : <p>{message}</p>}
      {items.length === 0 ? null : (
        <ul className="form-summary__list">
          {items.map((item) => (
            <li key={item.fieldId}>
              <a
                className="link"
                href={`#${item.fieldId}`}
                onClick={(event) => {
                  event.preventDefault()
                  document.getElementById(item.fieldId)?.focus()
                }}
              >
                {item.message}
              </a>
            </li>
          ))}
        </ul>
      )}
      {requestId === undefined ? null : (
        <p className="muted">
          Reference: <code>{requestId}</code>
        </p>
      )}
    </Alert>
  )
}
