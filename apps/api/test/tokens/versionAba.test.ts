import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { post } from '../support/authApp'
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

// ABA (ADR 0014): a token's version must NEVER repeat for the same path across
// delete and re-create. The invariant that makes it safe: a token's version never
// exceeds the brand's draftRevision at its last write (so a create at the NEW
// revision is larger than any version the path ever had).

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const body = (r: request.Response) => r.body as TokenBody
const NUMBER = { type: 'number', value: 1 }

function doImport(t: TokenTeam, tree: unknown, expectedRevision: number) {
  return post(request(t.app), tokensUrl(t, '/import'), {
    tree,
    expectedRevision,
  }).set('Cookie', t.editor.cookie)
}

const numberTree = (names: readonly string[]) => ({
  primitive: {
    n: Object.fromEntries(
      names.map((name) => [name, { $type: 'number', $value: 1 }]),
    ),
  },
})

describe('ABA: create after delete', () => {
  it('create, delete, re-create, then a PUT with the OLD version is a 409', async () => {
    const t = await tokenTeam(pool, db)
    const created = await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    expect(created.status).toBe(201)
    const oldVersion = body(created).token?.version ?? -1

    expect(
      (await deleteToken(t, t.editor, 'primitive.n.a', oldVersion)).status,
    ).toBe(200)
    const again = await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    expect(again.status).toBe(201)
    const newVersion = body(again).token?.version ?? -1
    expect(newVersion).toBeGreaterThan(oldVersion)

    const stale = await putToken(t, t.editor, 'primitive.n.a', {
      ...NUMBER,
      value: 99,
      expectedVersion: oldVersion,
    })
    expect(stale.status).toBe(409)
    expect(body(stale).error?.code).toBe('VERSION_CONFLICT')
    expect(body(stale).error?.details?.currentVersion).toBe(newVersion)
    // nothing was overwritten
    expect((await tokenRows(pool, t.brand))[0]?.value).toBe(1)
  })

  it('a stale DELETE with the OLD version cannot remove the re-created token', async () => {
    const t = await tokenTeam(pool, db)
    const created = await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    const oldVersion = body(created).token?.version ?? -1
    await deleteToken(t, t.editor, 'primitive.n.a', oldVersion)
    await putToken(t, t.editor, 'primitive.n.a', NUMBER)

    const stale = await deleteToken(t, t.editor, 'primitive.n.a', oldVersion)
    expect(stale.status).toBe(409)
    expect(await tokenRows(pool, t.brand)).toHaveLength(1)
  })

  it('a create gets version = the NEW draftRevision', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    await putToken(t, t.editor, 'primitive.n.b', NUMBER)
    const third = await putToken(t, t.editor, 'primitive.n.c', NUMBER)
    expect(body(third).draftRevision).toBe(3)
    expect(body(third).token?.version).toBe(3)
  })

  it('an update still adds exactly 1', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    await putToken(t, t.editor, 'primitive.n.b', NUMBER) // revision 2, version 2
    const updated = await putToken(t, t.editor, 'primitive.n.a', {
      ...NUMBER,
      expectedVersion: 1,
    })
    expect(body(updated).token?.version).toBe(2)
    expect(body(updated).draftRevision).toBe(3)
  })
})

describe('ABA: import', () => {
  it('a NEW path in an import gets version = the new draftRevision; a surviving path gets old + 1', async () => {
    const t = await tokenTeam(pool, db)
    await putToken(t, t.editor, 'primitive.n.a', NUMBER) // rev 1, v1
    await putToken(t, t.editor, 'primitive.n.b', NUMBER) // rev 2, v2
    const imported = await doImport(t, numberTree(['a', 'c']), 2)
    expect(imported.status).toBe(200)
    expect(body(imported).draftRevision).toBe(3)
    const versions = Object.fromEntries(
      (await tokenRows(pool, t.brand)).map((r) => [r.path, r.version]),
    )
    expect(versions).toEqual({ 'primitive.n.a': 2, 'primitive.n.c': 3 })
  })

  it('delete then import-as-new: a stale version of the deleted path cannot match', async () => {
    const t = await tokenTeam(pool, db)
    const created = await putToken(t, t.editor, 'primitive.n.a', NUMBER)
    const oldVersion = body(created).token?.version ?? -1
    await deleteToken(t, t.editor, 'primitive.n.a', oldVersion)
    await doImport(t, numberTree(['a']), await revisionOf(pool, t.brand))
    const stale = await putToken(t, t.editor, 'primitive.n.a', {
      ...NUMBER,
      expectedVersion: oldVersion,
    })
    expect(stale.status).toBe(409)
  })
})

describe('ABA: the invariant holds over random operation sequences', () => {
  // A small seeded generator, so a failure is reproducible.
  function rng(seed: number) {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 2 ** 32
    }
  }

  it.each([1, 2, 3])(
    'seed %i: version <= draftRevision always, and a path never reuses a version',
    async (seed) => {
      const t = await tokenTeam(pool, db)
      const next = rng(seed)
      const paths = ['a', 'b', 'c', 'd'].map((n) => `primitive.n.${n}`)
      const seen = new Map<string, Set<number>>()

      const check = async () => {
        const revision = await revisionOf(pool, t.brand)
        for (const row of await tokenRows(pool, t.brand)) {
          expect(
            row.version,
            `${row.path} at revision ${revision}`,
          ).toBeLessThanOrEqual(revision)
        }
      }
      // A version just written for `path`: it must be new for that path, unless it is
      // an UPDATE of the live token (which adds 1 to the previous one, so also new).
      const record = (path: string, version: number) => {
        const set = seen.get(path) ?? new Set<number>()
        expect(set.has(version), `${path} reused version ${version}`).toBe(
          false,
        )
        set.add(version)
        seen.set(path, set)
      }

      for (let step = 0; step < 40; step += 1) {
        const path = paths[Math.floor(next() * paths.length)] ?? paths[0] ?? ''
        const live = (await tokenRows(pool, t.brand)).find(
          (r) => r.path === path,
        )
        const roll = next()
        if (roll < 0.15) {
          const revision = await revisionOf(pool, t.brand)
          const names = paths.filter(() => next() < 0.5).map((p) => p.slice(-1))
          if (names.length === 0) continue
          const before = new Map(
            (await tokenRows(pool, t.brand)).map((r) => [r.path, r.version]),
          )
          const r = await doImport(t, numberTree(names), revision)
          expect(r.status).toBe(200)
          for (const row of await tokenRows(pool, t.brand)) {
            if (before.get(row.path) !== row.version)
              record(row.path, row.version)
          }
        } else if (live === undefined) {
          const r = await putToken(t, t.editor, path, NUMBER)
          expect(r.status).toBe(201)
          record(path, body(r).token?.version ?? -1)
        } else if (roll < 0.6) {
          const r = await putToken(t, t.editor, path, {
            ...NUMBER,
            expectedVersion: live.version,
          })
          expect(r.status).toBe(200)
          record(path, body(r).token?.version ?? -1)
        } else {
          const r = await deleteToken(t, t.editor, path, live.version)
          expect(r.status).toBe(200)
        }
        await check()
      }
      expect(seen.size).toBeGreaterThan(0) // not vacuous
    },
    120_000,
  )
})
