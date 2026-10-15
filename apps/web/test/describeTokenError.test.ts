import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/client'
import { describeTokenError } from '../src/forms/describeError'

// What a failed token write, delete or import means for the editor. Pure.
// Server sentences are never passed through, except the issue messages of a 400
// (the API builds those from fixed text), and even those only as React text.

const HOSTILE = '<img src=x onerror=alert(1)>'

function apiError(
  status: number,
  code: string,
  details?: Record<string, unknown>,
  extra: { requestId?: string; retryAfterSeconds?: number } = {},
) {
  return new ApiError({ status, code, message: HOSTILE, details, ...extra })
}

describe('describeTokenError', () => {
  it('a version conflict carries the current version, or null when the token is gone', () => {
    expect(
      describeTokenError(
        apiError(409, 'VERSION_CONFLICT', { currentVersion: 7 }),
      ),
    ).toEqual({ kind: 'conflict', currentVersion: 7 })
    expect(
      describeTokenError(
        apiError(409, 'VERSION_CONFLICT', { currentVersion: null }),
      ),
    ).toEqual({ kind: 'gone' })
  })

  it('"version required" (someone created that path meanwhile) is a conflict too', () => {
    expect(
      describeTokenError(
        apiError(409, 'VERSION_REQUIRED', { currentVersion: 3 }),
      ),
    ).toEqual({ kind: 'conflict', currentVersion: 3 })
    expect(describeTokenError(apiError(409, 'VERSION_REQUIRED'))).toEqual({
      kind: 'conflict',
      currentVersion: undefined,
    })
  })

  it('ignores a currentVersion that is not a positive integer', () => {
    for (const bad of ['7', -1, 0, 1.5, Number.NaN, {}, [], true]) {
      expect(
        describeTokenError(
          apiError(409, 'VERSION_CONFLICT', { currentVersion: bad }),
        ),
      ).toEqual({ kind: 'conflict', currentVersion: undefined })
    }
  })

  it('a path conflict names the other path as plain data, when it is a plain path', () => {
    expect(
      describeTokenError(
        apiError(409, 'PATH_CONFLICT', {
          conflictsWith: 'primitive.color.blue',
        }),
      ),
    ).toEqual({ kind: 'pathConflict', conflictsWith: 'primitive.color.blue' })
    expect(
      describeTokenError(
        apiError(409, 'PATH_CONFLICT', { conflictsWith: HOSTILE }),
      ),
    ).toEqual({ kind: 'pathConflict', conflictsWith: undefined })
  })

  it('the token limit, a stale import revision and a busy server each have their own kind', () => {
    expect(describeTokenError(apiError(409, 'TOKEN_LIMIT'))).toEqual({
      kind: 'limit',
    })
    expect(
      describeTokenError(
        apiError(409, 'REVISION_CONFLICT', { currentRevision: 9 }),
      ),
    ).toEqual({ kind: 'revisionConflict' })
  })

  it('a 400 lists its issues (field and message) and the total', () => {
    const result = describeTokenError(
      apiError(400, 'INVALID_TOKEN', {
        issues: [
          {
            code: 'INVALID_VALUE',
            severity: 'error',
            path: 'a.b',
            field: 'value',
            message: 'Bad value.',
          },
          {
            code: 'INVALID_NAME',
            severity: 'error',
            path: 'a.b',
            field: 'path',
            message: 'Bad path.',
          },
          { nonsense: true },
        ],
        issueCount: 5,
      }),
    )
    expect(result).toEqual({
      kind: 'invalid',
      issues: [
        { field: 'value', message: 'Bad value.' },
        { field: 'path', message: 'Bad path.' },
      ],
      issueCount: 5,
    })
  })

  it('a 400 without usable details is a generic "other"', () => {
    const result = describeTokenError(apiError(400, 'VALIDATION_ERROR'))
    expect(result.kind).toBe('other')
  })

  it('403, 404, 429, 503 and network failures use the shared wording and never echo server text', () => {
    for (const [status, pattern] of [
      [403, /role/i],
      [404, /no longer|cannot be found/i],
      [429, /too many/i],
      [503, /busy/i],
      [0, /reach the server/i],
    ] as const) {
      const result = describeTokenError(apiError(status, 'X'))
      expect(result.kind, String(status)).toBe('other')
      expect(result.kind === 'other' && result.form, String(status)).toMatch(
        pattern,
      )
      expect(JSON.stringify(result)).not.toContain('onerror')
    }
  })

  it('an unknown error carries the request id so a person can quote it', () => {
    const result = describeTokenError(
      apiError(500, 'BOOM', undefined, { requestId: 'req-1234abcd' }),
    )
    expect(result).toMatchObject({ kind: 'other', requestId: 'req-1234abcd' })
  })

  it('anything that is not an ApiError is a generic "other"', () => {
    expect(describeTokenError(new Error('boom <b>')).kind).toBe('other')
    expect(JSON.stringify(describeTokenError(null))).not.toContain('boom')
  })
})
