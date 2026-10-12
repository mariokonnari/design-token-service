import { nest } from '@dts/tokens-core'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { rowToToken } from '../../src/tokens/mapper'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  draftTree,
  publish,
  releaseRows,
  seedDraft,
  type ReleaseBody,
} from '../support/releaseFixture'
import {
  putToken,
  revisionOf,
  tokenTeam,
  type TokenTeam,
} from '../support/tokenFixture'

// REAL concurrent HTTP requests against real Postgres. Publish takes the SAME brand
// row lock as every draft mutation (ADR 0015), reads the draft rows only AFTER it
// holds the lock, and computes the release number under it.
//
// Iteration counts (stated in ADR 0015):
//   1. six concurrent publishes at one revision ........ 100
//   2. publish racing a token PUT (two variants) ........ 100 each
//   3. scenario 1 with the pool limited to 3 connections .. 15
//   4. deterministic lock-hold ordering tests ............ 1 each (no timing luck)
//
// HONEST CAVEAT (ADR 0014 precedent): the unique constraint and the revision check
// can MASK a missing lock in the stress scenarios 1 and 2. The deterministic tests
// in section 4 are what actually prove "number and rows are taken under the lock".

const { pool } = useDatabase()
const url = assertTestDatabase(process.env['DATABASE_URL'])
const db = createPrismaClient(url)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const body = (r: request.Response) => r.body as ReleaseBody
const code = (r: request.Response) => body(r).error?.code

const N = 6
const ITER = 100

async function sixAtOnce(t: TokenTeam, iterations: number) {
  await seedDraft(pool, t)
  for (let i = 0; i < iterations; i += 1) {
    const revision = await revisionOf(pool, t.brand)
    const responses = await Promise.all(
      Array.from({ length: N }, (_, n) =>
        publish(t, n % 2 === 0 ? t.editor : t.owner, {
          expectedRevision: revision,
        }),
      ),
    )
    const statuses = responses.map((r) => r.status).sort()
    expect(statuses, `iteration ${i}: ${JSON.stringify(statuses)}`).toEqual([
      201,
      ...Array.from({ length: N - 1 }, () => 409),
    ])
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(code(r), `iteration ${i}`).toBe('NO_CHANGES')
      expect(body(r).error?.details?.latestReleaseNumber).toBe(i + 1)
    }
    const winner = responses.find((r) => r.status === 201)
    expect(body(winner as request.Response).release).toMatchObject({
      number: i + 1,
      sourceRevision: revision,
    })
    // move the revision so the next iteration has something new to publish
    expect(
      (
        await putToken(t, t.editor, `semantic.race.t${i}`, {
          type: 'number',
          value: i,
        })
      ).status,
    ).toBe(201)
  }
  const numbers = (await releaseRows(pool, t.brand)).map((r) => r.number)
  expect(numbers).toEqual(Array.from({ length: iterations }, (_, n) => n + 1))
}

describe('1. six concurrent publishes at the same revision', () => {
  it(`exactly one 201, five 409 NO_CHANGES, numbers contiguous (${ITER} iterations)`, async () => {
    await sixAtOnce(await tokenTeam(pool, db), ITER)
  }, 600_000)
})

/** Draft rows (with description) as the snapshot would be built from them. */
async function treeNow(t: TokenTeam) {
  return draftTree(pool, t.brand)
}

describe('2. a publish racing a token PUT', () => {
  /**
   * `target` is the revision the publish asks for: r (variant A, the PUT is a LATER change)
   * or r + 1 (variant B, the publish wants the state the PUT creates).
   * Whichever wins, the release must equal the draft as of its own sourceRevision.
   */
  async function race(variant: 'A' | 'B') {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t)
    const outcomes = { published: 0, conflicted: 0 }
    for (let i = 0; i < ITER; i += 1) {
      const r0 = await revisionOf(pool, t.brand)
      const before = await treeNow(t)
      const expectedRevision = variant === 'A' ? r0 : r0 + 1
      const path = `semantic.race.p${variant.toLowerCase()}${i}`
      // A random 0-39 ms head start for one side, so BOTH orders happen across the
      // iterations (without it one request always arrives first).
      const delay = Math.floor(Math.random() * 40)
      const publishLate = Math.random() < 0.5
      const later = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms))
      const [pub, put] = await Promise.all([
        (async () => {
          if (publishLate) await later(delay)
          return publish(t, t.editor, { expectedRevision }).then((r) => r)
        })(),
        (async () => {
          if (!publishLate) await later(delay)
          return putToken(t, t.owner, path, { type: 'number', value: i }).then(
            (r) => r,
          )
        })(),
      ])
      const label = `${variant} iteration ${i}: publish ${pub.status} put ${put.status}`
      // the PUT never fails: it creates a new path
      expect(put.status, label).toBe(201)
      const after = await treeNow(t)
      expect(await revisionOf(pool, t.brand), label).toBe(r0 + 1)

      const rows = await releaseRows(pool, t.brand)
      if (pub.status === 201) {
        outcomes.published += 1
        const release = body(pub).release
        // consistent: the snapshot is EXACTLY the draft at the release's sourceRevision
        const stored = rows.find((x) => x.number === release?.number)
        expect(stored, label).toBeDefined()
        if (release?.sourceRevision === r0) {
          expect(stored?.snapshot, label).toEqual(before)
        } else {
          expect(release?.sourceRevision, label).toBe(r0 + 1)
          expect(stored?.snapshot, label).toEqual(after)
        }
        expect(release?.sourceRevision, label).toBe(expectedRevision)
      } else {
        // the loser gets a clean 409 REVISION_CONFLICT (never a 5xx, never a half-state)
        outcomes.conflicted += 1
        expect(pub.status, label).toBe(409)
        expect(code(pub), label).toBe('REVISION_CONFLICT')
        expect(body(pub).error?.details?.currentRevision, label).toBe(
          variant === 'A' ? r0 + 1 : r0,
        )
      }
    }
    // not vacuous: BOTH orders happened (reported in ADR 0015)
    console.log(`race variant ${variant}: ${JSON.stringify(outcomes)}`)
    expect(outcomes.published, `variant ${variant}`).toBeGreaterThan(0)
    expect(outcomes.conflicted, `variant ${variant}`).toBeGreaterThan(0)
  }

  it(`variant A (publish at r, PUT is a later change): ${ITER} iterations`, async () => {
    await race('A')
  }, 600_000)

  it(`variant B (publish at r+1, the state the PUT creates): ${ITER} iterations`, async () => {
    await race('B')
  }, 600_000)
})

describe('3. nothing inside the publish lock needs a SECOND connection', () => {
  it('scenario 1 passes with the pool limited to 3 connections', async () => {
    const small = createPrismaClient(url, { poolMax: 3 })
    await small.$connect()
    try {
      await sixAtOnce(await tokenTeam(pool, small), 15)
    } finally {
      await small.$disconnect()
    }
  }, 300_000)
})

describe('4. deterministic ordering: a raw connection holds the brand lock', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('(i) the release NUMBER is computed under the lock, after the holder’s release committed', async () => {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t) // revision 3
    expect((await publish(t, t.editor, { expectedRevision: 3 })).status).toBe(
      201,
    ) // release 1
    await putToken(t, t.editor, 'semantic.n.x', { type: 'number', value: 1 }) // revision 4

    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      // B asks for revision 5: it only becomes valid once the holder commits
      // (supertest requests are LAZY: .then() starts the request now)
      const waiting = publish(t, t.owner, { expectedRevision: 5 }).then(
        (r) => r,
      )
      await wait(400) // B is now blocked on the lock
      // what a concurrent publish A (release 2 at revision 4) followed by a PUT does
      await holder.query(
        `INSERT INTO "Release"
           ("brandId", "number", "sourceRevision", "snapshot", "css", "cssSha256", "createdById")
         VALUES ($1, 2, 4, '{}'::jsonb, ':root {}', repeat('a', 64), $2)`,
        [t.brand, t.editor.id],
      )
      await holder.query(
        `INSERT INTO "Token" ("brandId", "path", "type", "value", "version")
         VALUES ($1, 'semantic.n.y', 'number', '2'::jsonb, 5)`,
        [t.brand],
      )
      await holder.query(
        'UPDATE "Brand" SET "draftRevision" = 5 WHERE id = $1',
        [t.brand],
      )
      await holder.query('COMMIT')
      const r = await waiting
      // the number was taken AFTER the lock: max(number) was already 2
      expect(r.status, JSON.stringify(r.body)).toBe(201)
      expect(body(r).release).toMatchObject({ number: 3, sourceRevision: 5 })
    } finally {
      holder.release()
    }
    expect((await releaseRows(pool, t.brand)).map((x) => x.number)).toEqual([
      1, 2, 3,
    ])
  })

  it('(ii) the draft ROWS are read under the lock, after the holder’s change committed', async () => {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t) // revision 3
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      const waiting = publish(t, t.editor, { expectedRevision: 3 }).then(
        (r) => r,
      )
      await wait(400) // the publish is blocked on the lock
      // the holder changes a token's value (no revision change) and commits
      await holder.query(
        `UPDATE "Token" SET "value" = '{"colorSpace":"srgb","components":[1,1,1]}'::jsonb
          WHERE "brandId" = $1 AND "path" = 'primitive.color.blue'`,
        [t.brand],
      )
      await holder.query('COMMIT')
      const r = await waiting
      expect(r.status, JSON.stringify(r.body)).toBe(201)
    } finally {
      holder.release()
    }
    const [row] = await releaseRows(pool, t.brand)
    // the snapshot has the holder's value, and so has the css derived from it
    expect(row?.snapshot).toEqual(await draftTree(pool, t.brand))
    expect(JSON.stringify(row?.snapshot)).toContain('"components":[1,1,1]')
    expect(row?.css).toContain('--semantic-color-action: #ffffff;')
  })

  it('(iii) the tree helper agrees with nest() of the mapped rows (guards the test helper itself)', async () => {
    const t = await tokenTeam(pool, db)
    await seedDraft(pool, t)
    const result = await pool.query<{
      path: string
      type: string | null
      value: unknown
      description: string | null
    }>(
      'SELECT path, type, value, description FROM "Token" WHERE "brandId" = $1',
      [t.brand],
    )
    const tokens = result.rows.flatMap((row) => {
      const mapped = rowToToken(row)
      return mapped.ok ? [mapped.token] : []
    })
    expect(await draftTree(pool, t.brand)).toEqual(nest(tokens).tree)
  })
})
