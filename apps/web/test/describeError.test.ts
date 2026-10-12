import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import {
  LOGIN_FAILED_MESSAGE,
  describeApiError,
  retryAfterText,
} from '../src/forms/describeError'

// Maps what the API can answer to what each form shows. Pure: no rendering.
// The hostile server text proves that only chosen status/code/field decide the
// result for most errors, and that server text is only passed through where the
// API documents it as user-safe (a 400 with a named field).

const HOSTILE = '<img src=x onerror=alert(1)>'

function apiError(
  status: number,
  code: string,
  extra: {
    message?: string
    details?: Record<string, unknown>
    requestId?: string
    retryAfterSeconds?: number
  } = {},
) {
  return new ApiError({
    status,
    code,
    message: extra.message ?? HOSTILE,
    details: extra.details,
    requestId: extra.requestId,
    retryAfterSeconds: extra.retryAfterSeconds,
  })
}

describe('login', () => {
  it('a 401 is ONE generic message, whatever the server says (no hint which part was wrong)', () => {
    const a = describeApiError(apiError(401, 'INVALID_CREDENTIALS'), 'login')
    const b = describeApiError(
      apiError(401, 'INVALID_CREDENTIALS', {
        message: 'No such user',
        details: { field: 'email' },
      }),
      'login',
    )
    expect(a).toEqual(b)
    expect(a.form).toBe(LOGIN_FAILED_MESSAGE)
    expect(a.fields).toEqual({})
    expect(LOGIN_FAILED_MESSAGE).toMatch(/email or password/i)
  })

  it('never reveals the server message', () => {
    const text = JSON.stringify(
      describeApiError(apiError(401, 'INVALID_CREDENTIALS'), 'login'),
    )
    expect(text).not.toContain('onerror')
  })
})

describe('signup', () => {
  it('409 EMAIL_TAKEN marks the email field', () => {
    const result = describeApiError(apiError(409, 'EMAIL_TAKEN'), 'signup')
    expect(result.fields['email']).toMatch(/already/i)
    expect(result.form).toBeUndefined()
  })

  it('403 SIGNUP_DISABLED is a form message', () => {
    const result = describeApiError(apiError(403, 'SIGNUP_DISABLED'), 'signup')
    expect(result.form).toMatch(/disabled/i)
  })

  it('a 400 without a field is a form-level message that keeps the server text (a fixed password-policy sentence)', () => {
    const result = describeApiError(
      apiError(400, 'VALIDATION_ERROR', {
        message: 'The password must be at least 12 characters.',
      }),
      'signup',
    )
    expect(result.fields).toEqual({})
    expect(result.form).toContain('at least 12 characters')
  })
})

describe.each(['createOrg', 'createBrand'] as const)('%s', (context) => {
  it('a 409 is a slug field error, whatever the code (a brand duplicate is the generic CONFLICT)', () => {
    for (const code of ['SLUG_TAKEN', 'CONFLICT']) {
      const result = describeApiError(apiError(409, code), context)
      expect(result.fields['slug'], code).toMatch(/already|taken|use/i)
      expect(result.form).toBeUndefined()
    }
  })

  it('a 400 with details.field = slug or name marks that field with the server text', () => {
    for (const field of ['slug', 'name']) {
      const result = describeApiError(
        apiError(400, 'VALIDATION_ERROR', {
          message: 'Fixed server sentence.',
          details: { field },
        }),
        context,
      )
      expect(result.fields[field]).toBe('Fixed server sentence.')
      expect(result.form).toBeUndefined()
    }
  })

  it.each([
    ['an unknown field', { field: 'bogus' }],
    ['a prototype key', { field: '__proto__' }],
    ['a non-string field', { field: 7 }],
    ['an object field', { field: { x: 1 } }],
    ['no details', undefined],
  ])('a 400 with %s becomes a form message', (_label, details) => {
    const result = describeApiError(
      apiError(400, 'VALIDATION_ERROR', { message: 'Fixed.', details }),
      context,
    )
    expect(result.fields).toEqual({})
    expect(result.form).toContain('Fixed.')
    expect(Object.keys(Object.prototype)).toEqual([])
  })

  it('a 403 says the role does not allow it', () => {
    const result = describeApiError(apiError(403, 'FORBIDDEN'), context)
    expect(result.form).toMatch(/role|permission|allowed/i)
    expect(result.form).not.toContain('onerror')
  })

  it('a 404 says the organization could not be found', () => {
    const result = describeApiError(apiError(404, 'NOT_FOUND'), context)
    expect(result.form).toMatch(/not found|no longer|cannot be found/i)
  })
})

describe('shared statuses', () => {
  it.each(['login', 'signup', 'createOrg', 'createBrand'] as const)(
    '429 on %s says how long to wait, from Retry-After',
    (context) => {
      const result = describeApiError(
        apiError(429, 'RATE_LIMITED', { retryAfterSeconds: 300 }),
        context,
      )
      expect(result.form).toMatch(/too many/i)
      expect(result.form).toContain('5 minutes')
    },
  )

  it('rounds up to whole minutes and says "1 minute"', () => {
    expect(retryAfterText(1)).toBe('1 minute')
    expect(retryAfterText(60)).toBe('1 minute')
    expect(retryAfterText(61)).toBe('2 minutes')
    expect(retryAfterText(3600)).toBe('60 minutes')
  })

  it('without Retry-After it gives no number', () => {
    expect(retryAfterText(undefined)).toBeUndefined()
    const result = describeApiError(apiError(429, 'RATE_LIMITED'), 'login')
    expect(result.form).toMatch(/later/i)
    expect(result.form).not.toMatch(/\d/)
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores a nonsense Retry-After (%s)',
    (value) => {
      expect(retryAfterText(value)).toBeUndefined()
    },
  )

  it('503 asks to try again', () => {
    const result = describeApiError(
      apiError(503, 'SERVICE_BUSY', { retryAfterSeconds: 1 }),
      'login',
    )
    expect(result.form).toMatch(/busy|try again/i)
  })

  it('a network failure says the server cannot be reached', () => {
    const result = describeApiError(apiError(0, 'NETWORK_ERROR'), 'login')
    expect(result.form).toMatch(/cannot reach|can’t reach|connection/i)
  })

  it('an unknown error is generic, never shows server text, and carries the request id', () => {
    const result = describeApiError(
      apiError(500, 'INTERNAL_ERROR', { requestId: 'req-12345678' }),
      'createOrg',
    )
    expect(result.form).toMatch(/something went wrong/i)
    expect(result.requestId).toBe('req-12345678')
    expect(JSON.stringify(result)).not.toContain('onerror')
  })

  it('an unexpected status with a hostile message is still generic', () => {
    const result = describeApiError(apiError(418, 'TEAPOT'), 'login')
    expect(JSON.stringify(result)).not.toContain('onerror')
    expect(result.form).toBeTypeOf('string')
  })

  it('anything that is not an ApiError is generic with no request id', () => {
    for (const thrown of [
      new Error('boom <b>x</b>'),
      'text',
      null,
      undefined,
    ]) {
      const result = describeApiError(thrown, 'login')
      expect(result.form).toMatch(/something went wrong/i)
      expect(result.requestId).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('boom')
    }
  })
})
