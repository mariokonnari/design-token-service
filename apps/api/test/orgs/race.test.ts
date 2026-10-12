import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import { authApp, del, patch } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  join,
  organization,
  ownersOf,
  person,
  type Person,
} from '../support/orgFixture'

// INVARIANT: an organization can never end up with zero OWNERs. These tests run
// REAL concurrent requests against real Postgres, many iterations, in several
// shapes. The write path locks the owner rows (SELECT ... FOR UPDATE) inside a
// transaction and re-checks the actor's role under that lock.

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const ITERATIONS = 30
const SUCCESS = new Set([200, 204])
/** A loser is refused cleanly: 409 LAST_OWNER, or 403 when the actor was demoted first. */
const REFUSED = new Set([403, 409])

type App = Awaited<ReturnType<typeof authApp>>['app']
type Action = (
  app: App,
  orgId: string,
  actor: Person,
  target: Person,
) => request.Test

const members = (org: string, user: string) =>
  `/api/orgs/${org}/members/${user}`
const demote: Action = (app, org, actor, target) =>
  patch(request(app), members(org, target.id), { role: 'EDITOR' }).set(
    'Cookie',
    actor.cookie,
  )
const remove: Action = (app, org, actor, target) =>
  del(request(app), members(org, target.id)).set('Cookie', actor.cookie)

async function freshOrg(
  ctx: Awaited<ReturnType<typeof authApp>>,
  owners: number,
) {
  const org = await organization(
    pool,
    `race-${Math.random().toString(36).slice(2, 10)}`,
  )
  const people: Person[] = []
  for (let i = 0; i < owners; i++) {
    const p = await person(
      pool,
      ctx.sessions,
      `owner${i}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    )
    await join(pool, p.id, org, 'OWNER')
    people.push(p)
  }
  return { org, people }
}

describe('two owners act on each other at the same instant', () => {
  const shapes: [string, Action, Action][] = [
    ['each demotes the other', demote, demote],
    ['each removes the other', remove, remove],
    ['one demotes, the other removes', demote, remove],
  ]

  it.each(shapes)(
    '%s: exactly one succeeds, one is refused, an owner always remains',
    async (_name, first, second) => {
      const ctx = await authApp(db)
      let refusedWith403 = 0
      let refusedWith409 = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const { org, people } = await freshOrg(ctx, 2)
        const [a, b] = people as [Person, Person]
        const [one, two] = await Promise.all([
          first(ctx.app, org, a, b),
          second(ctx.app, org, b, a),
        ])
        const statuses = [one.status, two.status]

        expect(
          statuses.filter((s) => SUCCESS.has(s)),
          `iteration ${i}: ${statuses.join(',')}`,
        ).toHaveLength(1)
        expect(
          statuses.filter((s) => REFUSED.has(s)),
          `iteration ${i}: ${statuses.join(',')}`,
        ).toHaveLength(1)
        expect(
          statuses.filter((s) => s >= 500),
          `iteration ${i}: ${statuses.join(',')}`,
        ).toHaveLength(0)
        expect(
          (await ownersOf(pool, org)).length,
          `iteration ${i}`,
        ).toBeGreaterThanOrEqual(1)

        for (const s of statuses) {
          if (s === 403) refusedWith403 += 1
          if (s === 409) refusedWith409 += 1
        }
      }
      // The loser was refused every time (by one of the two clean refusals).
      expect(refusedWith403 + refusedWith409).toBe(ITERATIONS)
    },
  )

  it('both owners leave at once: exactly one leaves, the other is the last owner', async () => {
    const ctx = await authApp(db)
    for (let i = 0; i < ITERATIONS; i++) {
      const { org, people } = await freshOrg(ctx, 2)
      const [a, b] = people as [Person, Person]
      const [one, two] = await Promise.all([
        remove(ctx.app, org, a, a),
        remove(ctx.app, org, b, b),
      ])
      const statuses = [one.status, two.status]
      expect(
        statuses.filter((s) => SUCCESS.has(s)),
        `iteration ${i}: ${statuses.join(',')}`,
      ).toHaveLength(1)
      expect(
        statuses.filter((s) => s === 409),
        `iteration ${i}: ${statuses.join(',')}`,
      ).toHaveLength(1)
      expect((await ownersOf(pool, org)).length).toBe(1)
    }
  })

  it('both owners demote THEMSELVES at once: exactly one does, the other keeps ownership', async () => {
    const ctx = await authApp(db)
    for (let i = 0; i < ITERATIONS; i++) {
      const { org, people } = await freshOrg(ctx, 2)
      const [a, b] = people as [Person, Person]
      const [one, two] = await Promise.all([
        demote(ctx.app, org, a, a),
        demote(ctx.app, org, b, b),
      ])
      const statuses = [one.status, two.status]
      expect(
        statuses.filter((s) => SUCCESS.has(s)),
        `iteration ${i}: ${statuses.join(',')}`,
      ).toHaveLength(1)
      expect(
        statuses.filter((s) => REFUSED.has(s)),
        `iteration ${i}: ${statuses.join(',')}`,
      ).toHaveLength(1)
      expect((await ownersOf(pool, org)).length).toBe(1)
    }
  })
})

describe('three owners in a cycle', () => {
  it('A acts on B, B on C, C on A at once: at most two succeed and an owner always remains', async () => {
    const ctx = await authApp(db)
    for (const action of [demote, remove]) {
      for (let i = 0; i < ITERATIONS; i++) {
        const { org, people } = await freshOrg(ctx, 3)
        const [a, b, c] = people as [Person, Person, Person]
        const responses = await Promise.all([
          action(ctx.app, org, a, b),
          action(ctx.app, org, b, c),
          action(ctx.app, org, c, a),
        ])
        const statuses = responses.map((r) => r.status)
        expect(
          statuses.filter((s) => s >= 500),
          `iteration ${i}: ${statuses.join(',')}`,
        ).toHaveLength(0)
        expect(
          statuses.every((s) => SUCCESS.has(s) || REFUSED.has(s)),
          `iteration ${i}: ${statuses.join(',')}`,
        ).toBe(true)
        expect(
          statuses.filter((s) => SUCCESS.has(s)).length,
        ).toBeLessThanOrEqual(2)
        expect(
          (await ownersOf(pool, org)).length,
          `iteration ${i}: ${statuses.join(',')}`,
        ).toBeGreaterThanOrEqual(1)
      }
    }
  }, 60_000)
})

describe('a stale session cannot act with a role it just lost', () => {
  it('an owner demoted a moment ago cannot demote the remaining owner', async () => {
    const ctx = await authApp(db)
    const { org, people } = await freshOrg(ctx, 2)
    const [a, b] = people as [Person, Person]
    // A demotes B. B's cookie is still valid and B's session might still be mid-request.
    expect((await demote(ctx.app, org, a, b)).status).toBe(200)
    // B (now an EDITOR) tries to demote A: refused by the policy, not applied.
    const attempt = await demote(ctx.app, org, b, a)
    expect(attempt.status).toBe(403)
    expect(await ownersOf(pool, org)).toEqual([a.id])
  })
})

describe('independent organizations do not block each other', () => {
  it('many organizations racing at once all keep an owner and none fails', async () => {
    const ctx = await authApp(db)
    const orgs = await Promise.all(
      Array.from({ length: 10 }, () => freshOrg(ctx, 2)),
    )
    const results = await Promise.all(
      orgs.map(({ org, people }) =>
        demote(ctx.app, org, people[0] as Person, people[1] as Person),
      ),
    )
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200))
    for (const { org } of orgs)
      expect((await ownersOf(pool, org)).length).toBe(1)
  })
})
