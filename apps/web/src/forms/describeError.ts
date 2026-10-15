import { ApiError } from '../api/client'

/**
 * Turns whatever a form submit threw into what the form shows (ADR 0016). Pure.
 *
 * - `fields` marks single inputs, `form` is the summary message, `requestId` is
 *   given only for errors nobody can act on, so a person can quote it.
 * - Server text is passed through ONLY for a 400, which the API builds from fixed
 *   sentences (and a named field for slug/name). Every other message is ours, so a
 *   proxy page or an unexpected error body can never reach the screen. And the
 *   result is always rendered as React text, never as markup.
 */

/** `load` is not a form: it is a failed read of a list or a page (same texts, no field errors). */
export type FormContext =
  'login' | 'signup' | 'createOrg' | 'createBrand' | 'load'

export interface DescribedError {
  fields: Partial<Record<string, string>>
  form?: string
  requestId?: string
}

/** One message for a wrong password AND an unknown email (ADR 0013: no account enumeration). */
export const LOGIN_FAILED_MESSAGE = 'Invalid email or password.'
const GENERIC_MESSAGE = 'Something went wrong. Try again.'

/** "5 minutes", from the Retry-After seconds; undefined when it is missing or nonsense. */
export function retryAfterText(
  seconds: number | undefined,
): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined
  }
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** The only fields the API names for a 400 on the create forms. */
function isNamedField(value: unknown): value is 'name' | 'slug' {
  return value === 'name' || value === 'slug'
}

const CREATE_CONTEXTS: readonly FormContext[] = ['createOrg', 'createBrand']

export function describeApiError(
  error: unknown,
  context: FormContext,
): DescribedError {
  if (!(error instanceof ApiError)) {
    return { fields: {}, form: GENERIC_MESSAGE }
  }
  const { status, code } = error
  const creating = CREATE_CONTEXTS.includes(context)

  if (status === 0) {
    return {
      fields: {},
      form: 'Cannot reach the server. Check your connection and try again.',
    }
  }

  if (status === 429) {
    const wait = retryAfterText(error.retryAfterSeconds)
    return {
      fields: {},
      form:
        wait === undefined
          ? 'Too many attempts. Try again later.'
          : `Too many attempts. Try again in about ${wait}.`,
    }
  }

  if (status === 503) {
    return {
      fields: {},
      form: 'The service is busy right now. Try again in a moment.',
    }
  }

  if (context === 'login' && status === 401) {
    return { fields: {}, form: LOGIN_FAILED_MESSAGE }
  }

  if (context === 'signup' && status === 409) {
    return {
      fields: { email: 'An account with this email address already exists.' },
    }
  }

  if (context === 'signup' && status === 403 && code === 'SIGNUP_DISABLED') {
    return { fields: {}, form: 'Sign-ups are currently disabled.' }
  }

  if (creating && status === 409) {
    return {
      fields: {
        slug: 'This slug is already in use. Choose a different one.',
      },
    }
  }

  if (status === 400) {
    const field = error.details?.['field']
    if (creating && isNamedField(field)) {
      return { fields: { [field]: error.message } }
    }
    return {
      fields: {},
      form: error.message === '' ? GENERIC_MESSAGE : error.message,
    }
  }

  if (creating && status === 403) {
    return {
      fields: {},
      form: 'Your role in this organization does not allow this action.',
    }
  }

  if (creating && status === 404) {
    return {
      fields: {},
      form: 'This organization cannot be found, or you no longer have access to it.',
    }
  }

  if (context === 'load' && status === 404) {
    return { fields: {}, form: 'This page could not be found.' }
  }

  if (status === 401) {
    return { fields: {}, form: 'Your session has expired. Sign in again.' }
  }

  return {
    fields: {},
    form: GENERIC_MESSAGE,
    ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
  }
}

/**
 * What a failed token write, delete or import means for the editor (ADR 0017).
 * Pure. Like describeApiError, server sentences are NOT passed through, with one
 * exception: the issue messages of a 400, which the API builds from fixed text and
 * which are rendered as React text only.
 */
export type TokenFailure =
  | { kind: 'conflict'; currentVersion: number | undefined }
  | { kind: 'gone' }
  | { kind: 'pathConflict'; conflictsWith: string | undefined }
  | { kind: 'limit' }
  | { kind: 'revisionConflict' }
  | {
      kind: 'invalid'
      issues: { field?: string; message: string }[]
      issueCount: number
    }
  | { kind: 'other'; form: string; requestId?: string }

const PLAIN_PATH = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

function issuesOf(
  details: Readonly<Record<string, unknown>> | undefined,
): { field?: string; message: string }[] | undefined {
  const raw = details?.['issues']
  if (!Array.isArray(raw)) return undefined
  const issues: { field?: string; message: string }[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { field, message } = entry as Record<string, unknown>
    if (typeof message !== 'string' || message === '') continue
    issues.push(typeof field === 'string' ? { field, message } : { message })
  }
  return issues.length === 0 ? undefined : issues
}

export function describeTokenError(error: unknown): TokenFailure {
  if (error instanceof ApiError && error.status === 409) {
    const { code, details } = error
    if (code === 'VERSION_CONFLICT' || code === 'VERSION_REQUIRED') {
      if (details?.['currentVersion'] === null) return { kind: 'gone' }
      return {
        kind: 'conflict',
        currentVersion: positiveInteger(details?.['currentVersion']),
      }
    }
    if (code === 'PATH_CONFLICT') {
      const other = details?.['conflictsWith']
      return {
        kind: 'pathConflict',
        conflictsWith:
          typeof other === 'string' && PLAIN_PATH.test(other)
            ? other
            : undefined,
      }
    }
    if (code === 'TOKEN_LIMIT') return { kind: 'limit' }
    if (code === 'REVISION_CONFLICT') return { kind: 'revisionConflict' }
  }
  if (error instanceof ApiError && error.status === 400) {
    const issues = issuesOf(error.details)
    if (issues !== undefined) {
      const total = error.details?.['issueCount']
      return {
        kind: 'invalid',
        issues,
        issueCount: positiveInteger(total) ?? issues.length,
      }
    }
  }
  if (error instanceof ApiError && error.status === 404) {
    return {
      kind: 'other',
      form: 'This token or brand cannot be found, or you no longer have access to it.',
    }
  }
  // Shared wording for everything else (403, 429, 503, network, unknown).
  const described = describeApiError(error, 'createBrand')
  return {
    kind: 'other',
    form: described.form ?? GENERIC_MESSAGE,
    ...(described.requestId === undefined
      ? {}
      : { requestId: described.requestId }),
  }
}
