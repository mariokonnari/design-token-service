import { describe, expect, it } from 'vitest'
import { useDatabase } from '../support/db'
import { makeBrand, makeRelease, makeUser } from './helpers'

// Release immutability is enforced by a BEFORE UPDATE OR DELETE trigger (ADR 0015).
// It guards against APPLICATION bugs: a table owner or superuser can still disable it,
// TRUNCATE is deliberately not blocked (the test harness truncates every table), and
// `prisma migrate diff` cannot see triggers, so these tests are its only guard.

const { pool } = useDatabase()

const MESSAGE = 'Release rows are immutable'

async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { code, message } = error as { code?: string; message: string }
    return { code, message }
  }
  return undefined
}

describe('the Release immutability trigger', () => {
  it('is installed (db:drift cannot see triggers, so this is its presence check)', async () => {
    const result = await pool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger
        WHERE tgrelid = '"Release"'::regclass AND NOT tgisinternal`,
    )
    expect(result.rows).toEqual([
      { tgname: 'Release_immutable', tgenabled: 'O' },
    ])
  })

  it('INSERT still works', async () => {
    await expect(makeRelease(pool)).resolves.toBeTruthy()
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(1)
  })

  it.each([
    ['css', `UPDATE "Release" SET "css" = 'x'`],
    ['snapshot', `UPDATE "Release" SET "snapshot" = '{}'::jsonb`],
    ['note', `UPDATE "Release" SET "note" = 'edited'`],
    ['number', `UPDATE "Release" SET "number" = 2`],
    ['cssSha256', `UPDATE "Release" SET "cssSha256" = repeat('b', 64)`],
    ['a no-op update', `UPDATE "Release" SET "css" = "css"`],
  ])(
    'an UPDATE (%s) fails with the trigger message and changes nothing',
    async (_name, sql) => {
      const release = await makeRelease(pool)
      const outcome = await failure(pool.query(sql))
      expect(outcome?.message).toContain(MESSAGE)
      const after = await pool.query('SELECT * FROM "Release"')
      expect(after.rows).toEqual([release])
    },
  )

  it('a DELETE fails with the trigger message and the row survives', async () => {
    await makeRelease(pool)
    const outcome = await failure(pool.query('DELETE FROM "Release"'))
    expect(outcome?.message).toContain(MESSAGE)
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(1)
  })

  it('the cascade from deleting a user or brand still cannot remove a release (foreign keys RESTRICT first)', async () => {
    const brand = await makeBrand(pool)
    const user = await makeUser(pool)
    await makeRelease(pool, { brandId: brand['id'], createdById: user['id'] })
    expect((await failure(pool.query('DELETE FROM "Brand"')))?.code).toBe(
      '23503',
    )
    expect((await failure(pool.query('DELETE FROM "User"')))?.code).toBe(
      '23503',
    )
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(1)
  })

  it('TRUNCATE ... CASCADE still works (the test harness depends on it)', async () => {
    await makeRelease(pool)
    await pool.query(
      'TRUNCATE TABLE "Release", "Brand", "User", "Organization" RESTART IDENTITY CASCADE',
    )
    expect((await pool.query('SELECT 1 FROM "Release"')).rowCount).toBe(0)
  })
})
