import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { makeBrand } from '../db/helpers'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  deleteToken,
  putToken,
  revisionOf,
  tokenRows,
  tokenTeam,
  tokensUrl,
  type TokenBody,
  type TokenTeam,
} from '../support/tokenFixture'
import { put } from '../support/authApp'

// REAL concurrent HTTP requests against real Postgres. Every draft mutation takes the
// brand row lock (SELECT ... FOR UPDATE) inside one transaction, so concurrent
// mutations of one brand run one after the other. Iteration counts (stated in ADR 0014):
//   1. N distinct creates ............ 50   (each iteration = 8 concurrent requests)
//   2. same expectedVersion .......... 100
//   3. a and a.b ..................... 100
//   4. same path ..................... 100

const { pool } = useDatabase()
const url = assertTestDatabase(process.env['DATABASE_URL'])
const db = createPrismaClient(url)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const status = (r: request.Response) => r.status
const code = (r: request.Response) => (r.body as TokenBody).error?.code

async function freshBrand(t: TokenTeam): Promise<TokenTeam> {
  const brand = String(
    (
      await makeBrand(pool, {
        organizationId: t.org,
        slug: `race-${Math.random().toString(36).slice(2, 10)}`,
      })
    )['id'],
  )
  return { ...t, brand }
}

const N = 8
const ITER_DISTINCT = 50
const ITER = 100

async function distinctCreates(t: TokenTeam, iterations: number) {
  for (let i = 0; i < iterations; i++) {
    const b = await freshBrand(t)
    const responses = await Promise.all(
      Array.from({ length: N }, (_, n) =>
        putToken(b, n % 2 === 0 ? t.editor : t.owner, `race.t${n}`, {
          type: 'number',
          value: n,
        }),
      ),
    )
    expect(responses.map(status), `iteration ${i}`).toEqual(
      Array.from({ length: N }, () => 201),
    )
    const rows = await tokenRows(pool, b.brand)
    expect(rows.map((r) => r.path).sort(), `iteration ${i}`).toEqual(
      Array.from({ length: N }, (_, n) => `race.t${n}`).sort(),
    )
    expect(new Set(rows.map((r) => r.path)).size).toBe(N)
    // exactly +N: no lost revision bump, no double bump
    expect(await revisionOf(pool, b.brand), `iteration ${i}`).toBe(N)
    // and every response reported a distinct revision 1..N
    const revisions = responses
      .map((r) => (r.body as TokenBody).draftRevision)
      .sort((a, b2) => (a ?? 0) - (b2 ?? 0))
    expect(revisions, `iteration ${i}`).toEqual(
      Array.from({ length: N }, (_, n) => n + 1),
    )
  }
}

describe('1. concurrent creates of DISTINCT paths', () => {
  it(`all succeed, draftRevision rises by exactly ${N}, no duplicates (${ITER_DISTINCT} iterations)`, async () => {
    const t = await tokenTeam(pool, db)
    await distinctCreates(t, ITER_DISTINCT)
  }, 300_000)
})

describe('2. two concurrent updates with the same expectedVersion', () => {
  it(`exactly one wins and one gets 409 VERSION_CONFLICT (${ITER} iterations)`, async () => {
    const t = await tokenTeam(pool, db)
    const b = await freshBrand(t)
    for (let i = 0; i < ITER; i++) {
      const path = `race.u${i}`
      expect(
        (await putToken(b, t.editor, path, { type: 'number', value: 0 }))
          .status,
      ).toBe(201)
      const [x, y] = await Promise.all([
        putToken(b, t.editor, path, {
          type: 'number',
          value: 1,
          expectedVersion: 1,
        }),
        putToken(b, t.owner, path, {
          type: 'number',
          value: 2,
          expectedVersion: 1,
        }),
      ])
      expect([x, y].map(status).sort(), `iteration ${i}`).toEqual([200, 409])
      const loser = status(x) === 409 ? x : y
      expect(code(loser)).toBe('VERSION_CONFLICT')
      expect((loser.body as TokenBody).error?.details?.currentVersion).toBe(2)
      const row = (await tokenRows(pool, b.brand)).find((r) => r.path === path)
      expect(row?.version, `iteration ${i}`).toBe(2)
    }
    // per iteration: 1 create + 1 winning update
    expect(await revisionOf(pool, b.brand)).toBe(ITER * 2)
  }, 300_000)

  it('an update racing a delete of the same version: one wins, one gets 409 or 404', async () => {
    const t = await tokenTeam(pool, db)
    const b = await freshBrand(t)
    for (let i = 0; i < 30; i++) {
      const path = `race.d${i}`
      await putToken(b, t.editor, path, { type: 'number', value: 0 })
      const [u, d] = await Promise.all([
        putToken(b, t.editor, path, {
          type: 'number',
          value: 1,
          expectedVersion: 1,
        }),
        deleteToken(b, t.owner, path, 1),
      ])
      const s = [u.status, d.status]
      // either the update won (200 then the delete sees version 2: 409) or the
      // delete won (200 then the update sees no token: 409 VERSION_CONFLICT)
      expect(
        s.filter((x) => x === 200),
        `iteration ${i}: ${s.join()}`,
      ).toHaveLength(1)
      expect(
        s.filter((x) => x === 409),
        `iteration ${i}: ${s.join()}`,
      ).toHaveLength(1)
    }
  }, 300_000)
})

describe('3. concurrent creation of a path and its child', () => {
  it(`exactly one of a.x and a.x.y is created, the other gets 409 PATH_CONFLICT (${ITER} iterations)`, async () => {
    const t = await tokenTeam(pool, db)
    for (let i = 0; i < ITER; i++) {
      const b = await freshBrand(t)
      const [parent, child] = await Promise.all([
        putToken(b, t.editor, 'a.x', { type: 'number', value: 1 }),
        putToken(b, t.owner, 'a.x.y', { type: 'number', value: 2 }),
      ])
      expect([parent.status, child.status].sort(), `iteration ${i}`).toEqual([
        201, 409,
      ])
      const loser = parent.status === 409 ? parent : child
      expect(code(loser)).toBe('PATH_CONFLICT')
      const rows = await tokenRows(pool, b.brand)
      expect(rows, `iteration ${i}`).toHaveLength(1)
      expect(await revisionOf(pool, b.brand)).toBe(1)
    }
  }, 300_000)
})

describe('4. concurrent creation of the SAME path', () => {
  it(`one 201, the rest 409, never a 5xx (${ITER} iterations x 4 requests)`, async () => {
    const t = await tokenTeam(pool, db)
    for (let i = 0; i < ITER; i++) {
      const b = await freshBrand(t)
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, n) =>
          putToken(b, n % 2 === 0 ? t.editor : t.owner, 'race.same', {
            type: 'number',
            value: n,
          }),
        ),
      )
      const statuses = responses.map(status).sort()
      expect(statuses, `iteration ${i}`).toEqual([201, 409, 409, 409])
      for (const r of responses.filter((x) => x.status === 409)) {
        expect(code(r)).toBe('VERSION_REQUIRED')
      }
      expect(await tokenRows(pool, b.brand)).toHaveLength(1)
      expect(await revisionOf(pool, b.brand)).toBe(1)
    }
  }, 300_000)
})

describe('reads are consistent snapshots (no lock, no torn reads)', () => {
  it('while 8 creates run, every GET sees tokens.length === draftRevision', async () => {
    const t = await tokenTeam(pool, db)
    for (let i = 0; i < 15; i++) {
      const b = await freshBrand(t)
      const writes = Array.from({ length: N }, (_, n) =>
        putToken(b, t.editor, `snap.t${n}`, { type: 'number', value: n }),
      )
      const reads = Array.from({ length: 12 }, () =>
        request(b.app).get(tokensUrl(b)).set('Cookie', t.viewer.cookie),
      )
      const [, got] = await Promise.all([
        Promise.all(writes),
        Promise.all(reads),
      ])
      for (const r of got) {
        const body = r.body as TokenBody
        expect(r.status).toBe(200)
        expect(body.tokens?.length, `iteration ${i}`).toBe(body.draftRevision)
      }
    }
  }, 300_000)
})

describe('nothing inside the lock needs a SECOND connection', () => {
  it('scenario 1 passes with the API’s pool limited to 3 connections', async () => {
    const small = createPrismaClient(url, { poolMax: 3 })
    await small.$connect()
    try {
      const t = await tokenTeam(pool, small)
      await distinctCreates(t, 10)
    } finally {
      await small.$disconnect()
    }
  }, 300_000)
})

describe('lock waiting policy: a held brand lock makes writers fail FAST with 503, not hang', () => {
  it('lock_timeout: a PUT behind a held lock answers 503 SERVICE_BUSY + Retry-After within the timeout; the holder’s data is untouched', async () => {
    const t = await tokenTeam(pool, db, {
      tokenTiming: { lockTimeoutMs: 300, txTimeoutMs: 3000, maxWaitMs: 1000 },
    })
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      const started = Date.now()
      const r = await putToken(t, t.editor, 'a.b', { type: 'number', value: 1 })
      const elapsed = Date.now() - started
      expect(r.status).toBe(503)
      expect(code(r)).toBe('SERVICE_BUSY')
      expect(r.headers['retry-after']).toBe('1')
      expect(elapsed).toBeLessThan(2000)
      expect(elapsed).toBeGreaterThanOrEqual(250)

      await holder.query(`UPDATE "Brand" SET name = 'held' WHERE id = $1`, [
        t.brand,
      ])
      await holder.query('COMMIT')
    } finally {
      holder.release()
    }
    const row = await pool.query(
      'SELECT name, "draftRevision" FROM "Brand" WHERE id = $1',
      [t.brand],
    )
    expect(row.rows).toEqual([{ name: 'held', draftRevision: 0 }])
    expect(await tokenRows(pool, t.brand)).toEqual([])
    // and the brand is writable again afterwards
    expect(
      (await putToken(t, t.editor, 'a.b', { type: 'number', value: 1 })).status,
    ).toBe(201)
  })

  it('a DELETE and an import-style replace behind a held lock fail the same way', async () => {
    const t = await tokenTeam(pool, db, {
      tokenTiming: { lockTimeoutMs: 200, txTimeoutMs: 3000, maxWaitMs: 1000 },
    })
    await putToken(t, t.editor, 'a.b', { type: 'number', value: 1 })
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      const d = await deleteToken(t, t.editor, 'a.b', 1)
      expect(d.status).toBe(503)
      expect(code(d)).toBe('SERVICE_BUSY')
    } finally {
      await holder.query('ROLLBACK')
      holder.release()
    }
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('maxWait: when the pool has no free connection for the transaction, the answer is 503 too (Prisma P2028), not 500', async () => {
    // The token repository gets a pool of ONE connection. Request 1 occupies it
    // (waiting for the held lock); request 2 cannot even start its transaction.
    const single = createPrismaClient(url, { poolMax: 1 })
    await single.$connect()
    const t = await tokenTeam(pool, db, {
      tokenDb: single,
      tokenTiming: { lockTimeoutMs: 1500, txTimeoutMs: 4000, maxWaitMs: 200 },
    })
    const holder = await pool.connect()
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM "Brand" WHERE id = $1 FOR UPDATE', [
        t.brand,
      ])
      const first = put(request(t.app), tokensUrl(t, '/a.b'), {
        type: 'number',
        value: 1,
      })
        .set('Cookie', t.editor.cookie)
        .then((r) => r)
      await new Promise((resolve) => setTimeout(resolve, 300))
      const second = await putToken(t, t.owner, 'a.c', {
        type: 'number',
        value: 2,
      })
      expect(second.status).toBe(503)
      expect(code(second)).toBe('SERVICE_BUSY')
      await holder.query('ROLLBACK')
      const done = await first
      expect(done.status).toBe(201)
    } finally {
      holder.release()
      await single.$disconnect()
    }
  }, 30_000)
})
