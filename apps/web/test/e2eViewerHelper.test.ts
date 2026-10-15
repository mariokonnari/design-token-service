import { describe, expect, it } from 'vitest'
import { e2eDatabaseUrl, viewerDatabaseUrl } from '../e2e/support/database'
import { addMember, type DbClient } from '../e2e/support/viewer'

// The Viewer e2e helper writes a membership row straight into the e2e database
// (there is no invitation API yet). It is test-only and DESTRUCTIVE in spirit, so it
// refuses to do anything unless the database name ends in `_test`, checked twice:
// on the URL before connecting, and on `current_database()` after.

const ORG = '22222222-2222-4222-8222-222222222222'
const GOOD = 'postgresql://dts:secret@localhost:5433/dts_e2e_test'

interface Recorder {
  urls: string[]
  queries: { text: string; values: unknown[] }[]
  ended: number
}

function fakeConnect(options: { database?: string; rowCount?: number }): {
  connect: (url: string) => Promise<DbClient>
  seen: Recorder
} {
  const seen: Recorder = { urls: [], queries: [], ended: 0 }
  const connect = (url: string): Promise<DbClient> => {
    seen.urls.push(url)
    return Promise.resolve({
      query: (text: string, values: unknown[] = []) => {
        seen.queries.push({ text, values })
        if (/current_database/i.test(text)) {
          return Promise.resolve({
            rows: [{ name: options.database ?? 'dts_e2e_test' }],
            rowCount: 1,
          })
        }
        return Promise.resolve({ rows: [], rowCount: options.rowCount ?? 1 })
      },
      end: () => {
        seen.ended += 1
        return Promise.resolve()
      },
    })
  }
  return { connect, seen }
}

describe('which database the helper may use', () => {
  it('derives dts_e2e_test from DATABASE_URL, like playwright.config.ts', () => {
    expect(
      e2eDatabaseUrl({
        DATABASE_URL: 'postgresql://dts:secret@localhost:5433/dts_test',
      }),
    ).toBe(GOOD)
  })

  it('E2E_DATABASE_URL overrides it', () => {
    expect(
      viewerDatabaseUrl({
        E2E_DATABASE_URL: 'postgresql://u:p@h:1/other_test',
        DATABASE_URL: 'postgresql://u:p@h:1/ignored',
      }),
    ).toContain('/other_test')
  })

  it.each([
    ['a development database', 'postgresql://u:p@h:5433/dts'],
    ['a production-looking name', 'postgresql://u:p@h:5432/design_tokens_prod'],
    [
      'a name that only contains _test',
      'postgresql://u:p@h:5432/dts_test_backup',
    ],
    ['a name with a path trick', 'postgresql://u:p@h:5432/dts%2F_test'],
    ['an upper-case name', 'postgresql://u:p@h:5432/DTS_TEST'],
  ])('refuses %s through E2E_DATABASE_URL', (_label, url) => {
    expect(() => viewerDatabaseUrl({ E2E_DATABASE_URL: url })).toThrow(/_test/)
  })

  it('refuses when no URL is configured at all (it never guesses a database)', () => {
    expect(() => viewerDatabaseUrl({})).toThrow()
  })

  it('does not echo the password in its message', () => {
    try {
      viewerDatabaseUrl({ E2E_DATABASE_URL: 'postgresql://u:hunter2@h/prod' })
    } catch (error) {
      expect(String(error)).not.toContain('hunter2')
      return
    }
    throw new Error('expected a refusal')
  })
})

describe('addMember', () => {
  it('REFUSES before connecting when the database is not a test database', async () => {
    const { connect, seen } = fakeConnect({})
    await expect(
      addMember(
        { email: 'a@b.test', organizationId: ORG },
        { env: { E2E_DATABASE_URL: 'postgresql://u:p@h:5432/dts' }, connect },
      ),
    ).rejects.toThrow(/_test/)
    expect(seen.urls).toEqual([])
    expect(seen.queries).toEqual([])
  })

  it('REFUSES after connecting when current_database() is not a test database, and writes nothing', async () => {
    const { connect, seen } = fakeConnect({ database: 'dts' })
    await expect(
      addMember(
        { email: 'a@b.test', organizationId: ORG },
        { env: { E2E_DATABASE_URL: GOOD }, connect },
      ),
    ).rejects.toThrow(/_test/)
    expect(seen.queries.some((q) => /insert/i.test(q.text))).toBe(false)
    expect(seen.ended).toBe(1)
  })

  it('inserts one membership with the role, using parameters only, and always closes the connection', async () => {
    const { connect, seen } = fakeConnect({})
    await addMember(
      { email: 'viewer@example.test', organizationId: ORG },
      { env: { E2E_DATABASE_URL: GOOD }, connect },
    )
    const insert = seen.queries.find((q) => /insert/i.test(q.text))
    expect(insert?.text).toMatch(/INSERT INTO "Membership"/)
    expect(insert?.values).toEqual(['viewer@example.test', ORG, 'VIEWER'])
    expect(insert?.text).not.toContain('viewer@example.test')
    expect(seen.urls).toEqual([GOOD])
    expect(seen.ended).toBe(1)
  })

  it('fails when no user has that email (it never creates users)', async () => {
    const { connect, seen } = fakeConnect({ rowCount: 0 })
    await expect(
      addMember(
        { email: 'nobody@example.test', organizationId: ORG },
        { env: { E2E_DATABASE_URL: GOOD }, connect },
      ),
    ).rejects.toThrow(/no user/i)
    expect(seen.ended).toBe(1)
  })

  it('rejects a malformed organization id or role before connecting', async () => {
    const { connect, seen } = fakeConnect({})
    await expect(
      addMember(
        { email: 'a@b.test', organizationId: 'x\'; DROP TABLE "User"; --' },
        { env: { E2E_DATABASE_URL: GOOD }, connect },
      ),
    ).rejects.toThrow()
    await expect(
      addMember(
        // @ts-expect-error not a role
        { email: 'a@b.test', organizationId: ORG, role: 'ROOT' },
        { env: { E2E_DATABASE_URL: GOOD }, connect },
      ),
    ).rejects.toThrow()
    expect(seen.urls).toEqual([])
  })
})
