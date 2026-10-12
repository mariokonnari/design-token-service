import { useEffect, useState, type FormEvent } from 'react'
import { describeApiError, type FormContext } from './describeError'
import type { FieldErrors } from './validation'

/**
 * The state machine shared by the four forms (sign in, sign up, create
 * organization, create brand), so they all behave the same way (ADR 0016):
 *
 *  1. Submit runs the client-side checks first. Problems are shown on the fields
 *     AND in a summary that takes keyboard focus (so a screen reader reads it and
 *     a keyboard user is next to the first field); nothing is sent.
 *  2. Otherwise the request is sent once (a second submit while one is in flight
 *     is ignored, even if it arrives before React re-renders).
 *  3. A failure is turned into field errors / one form message by
 *     describeApiError (a 409 on the slug, a 400 that names a field, a generic
 *     message for the login 401, the retry time for a 429, the request id for an
 *     unknown error), and the summary takes focus again.
 *  4. Editing a field clears the error on that field.
 */

export interface SubmitFormOptions<K extends string, R> {
  context: FormContext
  initial: Record<K, string>
  /** The fields in page order (the summary lists errors in this order). */
  order: readonly K[]
  /** The DOM id of each field's input (the summary links to it). */
  fieldIds: Record<K, string>
  validate: (values: Record<K, string>) => FieldErrors<K>
  submit: (values: Record<K, string>) => Promise<R>
  onSuccess: (result: R, values: Record<K, string>) => void
  /** Values to empty after a failed submit (a password is never kept). */
  clearOnError?: readonly K[]
}

export interface SummaryItem {
  fieldId: string
  message: string
}

/** One submit at a time: enter() is true only for the caller that got in (checked after validation). */
function createGuard() {
  let busy = false
  return {
    isBusy(): boolean {
      return busy
    },
    enter(): boolean {
      if (busy) return false
      busy = true
      return true
    },
    leave(): void {
      busy = false
    },
  }
}

export function useSubmitForm<K extends string, R>(
  options: SubmitFormOptions<K, R>,
) {
  const { context, order, fieldIds } = options
  const [values, setValues] = useState<Record<K, string>>(options.initial)
  const [errors, setErrors] = useState<FieldErrors<K>>({})
  const [formMessage, setFormMessage] = useState<string | undefined>()
  const [requestId, setRequestId] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  // Not React state on purpose: a second submit can arrive before React has
  // re-rendered with pending = true, so the guard must change synchronously.
  const [guard] = useState(createGuard)
  // The summary element, kept in state through a callback ref, and a counter that
  // asks for focus: after the render that shows the summary, move focus to it.
  const [summary, attachSummary] = useState<HTMLDivElement | null>(null)
  const [focusRequests, setFocusRequests] = useState(0)
  useEffect(() => {
    if (focusRequests > 0) summary?.focus()
  }, [focusRequests, summary])

  function setValue(name: K, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    setErrors((current) => {
      if (current[name] === undefined) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  function reset() {
    setValues(options.initial)
    setErrors({})
    setFormMessage(undefined)
    setRequestId(undefined)
  }

  function fail(
    fields: FieldErrors<K>,
    form: string | undefined,
    reference: string | undefined,
  ) {
    setErrors(fields)
    setFormMessage(form)
    setRequestId(reference)
    setFocusRequests((count) => count + 1)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (guard.isBusy()) return

    const problems = options.validate(values)
    if (order.some((name) => problems[name] !== undefined)) {
      fail(problems, undefined, undefined)
      return
    }

    if (!guard.enter()) return
    setPending(true)
    setErrors({})
    setFormMessage(undefined)
    setRequestId(undefined)
    try {
      const result = await options.submit(values)
      options.onSuccess(result, values)
    } catch (error) {
      const described = describeApiError(error, context)
      const fields: FieldErrors<K> = {}
      for (const name of order) {
        const message = described.fields[name]
        if (message !== undefined) fields[name] = message
      }
      fail(fields, described.form, described.requestId)
      if (options.clearOnError !== undefined) {
        const cleared = options.clearOnError
        setValues((current) => {
          const next = { ...current }
          for (const name of cleared) next[name] = ''
          return next
        })
      }
    } finally {
      guard.leave()
      setPending(false)
    }
  }

  const summaryItems: SummaryItem[] = order.flatMap((name) => {
    const message = errors[name]
    return message === undefined ? [] : [{ fieldId: fieldIds[name], message }]
  })

  return {
    values,
    setValue,
    reset,
    errors,
    formMessage,
    requestId,
    pending,
    handleSubmit,
    attachSummary,
    summaryItems,
    hasProblems: summaryItems.length > 0 || formMessage !== undefined,
  }
}
