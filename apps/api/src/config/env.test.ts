import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env'

const valid = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pw@localhost:5433/dts_dev',
  SESSION_SECRET: 'x'.repeat(32),
}

function failure(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source)
  } catch (error) {
    if (error instanceof EnvError) return error
    throw error
  }
  throw new Error('expected parseEnv to throw')
}

const names = (error: EnvError) => error.issues.map((i) => i.variable).sort()

describe('parseEnv: valid input and defaults', () => {
  it('accepts the minimum set and applies the defaults', () => {
    expect(parseEnv(valid)).toEqual({
      NODE_ENV: 'production',
      DATABASE_URL: valid.DATABASE_URL,
      SESSION_SECRET: valid.SESSION_SECRET,
      PORT: 3000,
      SIGNUP_ENABLED: true,
      ALLOWED_ORIGINS: [],
    })
  })

  it('parses every variable', () => {
    const env = parseEnv({
      ...valid,
      NODE_ENV: 'development',
      PORT: '8080',
      SIGNUP_ENABLED: 'false',
      ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:5173 ,',
    })
    expect(env.PORT).toBe(8080)
    expect(env.SIGNUP_ENABLED).toBe(false)
    expect(env.ALLOWED_ORIGINS).toEqual([
      'https://app.example.com',
      'http://localhost:5173',
    ])
  })

  it.each(['postgres://h/db', 'postgresql://u:p@h:5432/db?sslmode=require'])(
    'accepts the database URL %s',
    (DATABASE_URL) => {
      expect(parseEnv({ ...valid, DATABASE_URL }).DATABASE_URL).toBe(
        DATABASE_URL,
      )
    },
  )

  it('treats blank optional variables as unset', () => {
    const env = parseEnv({
      ...valid,
      PORT: '',
      SIGNUP_ENABLED: '',
      ALLOWED_ORIGINS: '',
    })
    expect(env.PORT).toBe(3000)
    expect(env.SIGNUP_ENABLED).toBe(true)
    expect(env.ALLOWED_ORIGINS).toEqual([])
  })

  it('ignores unrelated variables', () => {
    expect(parseEnv({ ...valid, PATH: '/bin', HOME: '/h' }).PORT).toBe(3000)
  })
})

describe('parseEnv: failing closed', () => {
  it('requires NODE_ENV (no default) and rejects other values', () => {
    expect(names(failure({ ...valid, NODE_ENV: undefined }))).toEqual([
      'NODE_ENV',
    ])
    expect(names(failure({ ...valid, NODE_ENV: 'staging' }))).toEqual([
      'NODE_ENV',
    ])
    expect(names(failure({ ...valid, NODE_ENV: '' }))).toEqual(['NODE_ENV'])
  })

  it('requires SESSION_SECRET in every environment and enforces its length', () => {
    for (const NODE_ENV of ['development', 'test', 'production']) {
      expect(
        names(failure({ ...valid, NODE_ENV, SESSION_SECRET: undefined })),
      ).toEqual(['SESSION_SECRET'])
    }
    expect(
      names(failure({ ...valid, SESSION_SECRET: 'x'.repeat(31) })),
    ).toEqual(['SESSION_SECRET'])
    expect(parseEnv({ ...valid, SESSION_SECRET: 'x'.repeat(32) })).toBeTruthy()
    expect(failure({ ...valid, SESSION_SECRET: '' }).message).toMatch(
      /SESSION_SECRET/,
    )
  })

  it('requires DATABASE_URL to be a postgres URL with a host and a database', () => {
    for (const DATABASE_URL of [
      undefined,
      '',
      'not a url',
      'mysql://u:p@h/db',
      'http://localhost/db',
      'postgresql://u:p@localhost',
      'postgresql://u:p@localhost/',
    ]) {
      expect(
        names(failure({ ...valid, DATABASE_URL })),
        String(DATABASE_URL),
      ).toEqual(['DATABASE_URL'])
    }
  })

  it.each(['0', '65536', '-1', '3.5', 'abc', '0x10', '3e3', ' 80'])(
    'rejects PORT=%s',
    (PORT) => {
      expect(names(failure({ ...valid, PORT }))).toEqual(['PORT'])
    },
  )

  it.each(['TRUE', 'yes', '1', 'on', 'False'])(
    'rejects SIGNUP_ENABLED=%s (only "true" or "false")',
    (SIGNUP_ENABLED) => {
      expect(names(failure({ ...valid, SIGNUP_ENABLED }))).toEqual([
        'SIGNUP_ENABLED',
      ])
    },
  )

  it.each([
    'https://app.example.com/',
    'https://app.example.com/path',
    'app.example.com',
    'ftp://example.com',
    'https://ok.example.com,not-an-origin',
  ])('rejects ALLOWED_ORIGINS=%s', (ALLOWED_ORIGINS) => {
    expect(names(failure({ ...valid, ALLOWED_ORIGINS }))).toEqual([
      'ALLOWED_ORIGINS',
    ])
  })
})

describe('parseEnv: the error message', () => {
  it('lists every invalid variable at once', () => {
    const error = failure({
      NODE_ENV: 'nope',
      DATABASE_URL: 'mysql://x/y',
      SESSION_SECRET: 'short',
      PORT: 'abc',
      SIGNUP_ENABLED: 'maybe',
      ALLOWED_ORIGINS: 'bad',
    })
    expect(names(error)).toEqual([
      'ALLOWED_ORIGINS',
      'DATABASE_URL',
      'NODE_ENV',
      'PORT',
      'SESSION_SECRET',
      'SIGNUP_ENABLED',
    ])
    for (const variable of names(error)) {
      expect(error.message).toContain(`- ${variable}:`)
    }
    expect(error.message.startsWith('Invalid environment variables:')).toBe(
      true,
    )
  })

  it('never prints a value, so secrets cannot leak into logs', () => {
    const secret = 'super-secret-but-too-short'
    const url = 'mysql://admin:hunter2@db.internal/prod'
    const error = failure({
      ...valid,
      SESSION_SECRET: secret,
      DATABASE_URL: url,
      NODE_ENV: 'prodution-typo',
    })
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain('hunter2')
    expect(error.message).not.toContain(url)
    expect(error.message).not.toContain('prodution-typo')
  })

  it('reports a variable once even when several rules fail', () => {
    const error = failure({ ...valid, DATABASE_URL: undefined })
    expect(
      error.issues.filter((i) => i.variable === 'DATABASE_URL'),
    ).toHaveLength(1)
  })
})
