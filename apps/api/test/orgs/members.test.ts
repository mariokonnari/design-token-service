import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../src/db/client'
import * as policy from '../../src/tenancy/policy'
import type { Role } from '../../src/tenancy/scope'
import { authApp, del, patch } from '../support/authApp'
import { useDatabase } from '../support/db'
import { assertTestDatabase } from '../support/guard'
import {
  join,
  organization,
  ownersOf,
  person,
  roleOf,
} from '../support/orgFixture'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

interface Body {
  members?: { userId: string; email: string; role: Role; joinedAt: string }[]
  member?: { userId: string; email: string; role: Role }
  error?: { code: string; message: string }
}

async function team() {
  const ctx = await authApp(db)
  const org = await organization(pool, 'team')
  const owner = await person(pool, ctx.sessions, 'owner@example.com')
  const owner2 = await person(pool, ctx.sessions, 'owner2@example.com')
  const editor = await person(pool, ctx.sessions, 'editor@example.com')
  const viewer = await person(pool, ctx.sessions, 'viewer@example.com')
  const outsider = await person(pool, ctx.sessions, 'outsider@example.com')
  await join(pool, owner.id, org, 'OWNER')
  await join(pool, editor.id, org, 'EDITOR')
  await join(pool, viewer.id, org, 'VIEWER')
  return { ...ctx, org, owner, owner2, editor, viewer, outsider }
}
const members = (org: string, userId = '') =>
  `/api/orgs/${org}/members${userId === '' ? '' : `/${userId}`}`

describe('GET /api/orgs/:orgId/members: any member', () => {
  it.each(['owner', 'editor', 'viewer'] as const)(
    'a %s can list the members',
    async (who) => {
      const ctx = await team()
      const response = await request(ctx.app)
        .get(members(ctx.org))
        .set('Cookie', ctx[who].cookie)
      expect(response.status).toBe(200)
      const list = (response.body as Body).members ?? []
      expect(list.map((m) => [m.email, m.role])).toEqual([
        ['editor@example.com', 'EDITOR'],
        ['owner@example.com', 'OWNER'],
        ['viewer@example.com', 'VIEWER'],
      ])
      expect(Object.keys(list[0] ?? {}).sort()).toEqual([
        'email',
        'joinedAt',
        'role',
        'userId',
      ])
    },
  )

  it('never exposes a password hash or session data', async () => {
    const ctx = await team()
    const response = await request(ctx.app)
      .get(members(ctx.org))
      .set('Cookie', ctx.viewer.cookie)
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|scrypt|sessionVersion/,
    )
  })

  it('a non-member gets 404', async () => {
    const ctx = await team()
    const response = await request(ctx.app)
      .get(members(ctx.org))
      .set('Cookie', ctx.outsider.cookie)
    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/orgs/:orgId/members/:userId: OWNER only', () => {
  it('lets an owner change another member’s role', async () => {
    const ctx = await team()
    const response = await patch(
      request(ctx.app),
      members(ctx.org, ctx.viewer.id),
      { role: 'EDITOR' },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(200)
    expect((response.body as Body).member).toMatchObject({
      userId: ctx.viewer.id,
      role: 'EDITOR',
    })
    expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('EDITOR')
  })

  it.each(['editor', 'viewer'] as const)(
    'a %s gets 403 and nothing changes',
    async (who) => {
      const ctx = await team()
      const response = await patch(
        request(ctx.app),
        members(ctx.org, ctx.viewer.id),
        { role: 'OWNER' },
      ).set('Cookie', ctx[who].cookie)
      expect(response.status).toBe(403)
      expect((response.body as Body).error?.code).toBe('FORBIDDEN')
      expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('VIEWER')
    },
  )

  it('a non-member gets 404', async () => {
    const ctx = await team()
    const response = await patch(
      request(ctx.app),
      members(ctx.org, ctx.viewer.id),
      { role: 'OWNER' },
    ).set('Cookie', ctx.outsider.cookie)
    expect(response.status).toBe(404)
  })

  it.each(['SUPERUSER', 'owner', '', 5, null])(
    'rejects the invalid role %j with 400',
    async (role) => {
      const ctx = await team()
      const response = await patch(
        request(ctx.app),
        members(ctx.org, ctx.viewer.id),
        { role },
      ).set('Cookie', ctx.owner.cookie)
      expect(response.status).toBe(400)
      expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('VIEWER')
    },
  )

  it.each([
    ['userId', { userId: '11111111-1111-4111-8111-111111111111' }],
    [
      'organizationId',
      { organizationId: '11111111-1111-4111-8111-111111111111' },
    ],
    ['email', { email: 'x@example.com' }],
    ['id', { id: '11111111-1111-4111-8111-111111111111' }],
  ])('rejects an extra %s field with 400', async (_name, extra) => {
    const ctx = await team()
    const response = await patch(
      request(ctx.app),
      members(ctx.org, ctx.viewer.id),
      { role: 'EDITOR', ...extra },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(400)
    expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('VIEWER')
  })

  it('a missing body is 400', async () => {
    const ctx = await team()
    const response = await patch(
      request(ctx.app),
      members(ctx.org, ctx.viewer.id),
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(400)
  })

  it('404 for a user who is not a member of this organization, or a malformed user id', async () => {
    const ctx = await team()
    for (const target of [
      ctx.outsider.id,
      '99999999-9999-4999-8999-999999999999',
      'not-a-uuid',
    ]) {
      const response = await patch(request(ctx.app), members(ctx.org, target), {
        role: 'EDITOR',
      }).set('Cookie', ctx.owner.cookie)
      expect(response.status, target).toBe(404)
    }
    expect(await roleOf(pool, ctx.org, ctx.outsider.id)).toBeNull()
  })

  it('refuses to demote the LAST owner (409 LAST_OWNER)', async () => {
    const ctx = await team()
    for (const role of ['EDITOR', 'VIEWER'] as const) {
      const response = await patch(
        request(ctx.app),
        members(ctx.org, ctx.owner.id),
        { role },
      ).set('Cookie', ctx.owner.cookie)
      expect(response.status).toBe(409)
      expect((response.body as Body).error?.code).toBe('LAST_OWNER')
    }
    expect(await ownersOf(pool, ctx.org)).toEqual([ctx.owner.id])
  })

  it('allows demoting an owner when another owner remains, then protects the survivor', async () => {
    const ctx = await team()
    await join(pool, ctx.owner2.id, ctx.org, 'OWNER')
    const first = await patch(
      request(ctx.app),
      members(ctx.org, ctx.owner2.id),
      { role: 'EDITOR' },
    ).set('Cookie', ctx.owner.cookie)
    expect(first.status).toBe(200)
    const second = await patch(
      request(ctx.app),
      members(ctx.org, ctx.owner.id),
      { role: 'EDITOR' },
    ).set('Cookie', ctx.owner.cookie)
    expect(second.status).toBe(409)
    expect(await ownersOf(pool, ctx.org)).toEqual([ctx.owner.id])
  })

  it('an owner may demote themselves when another owner remains', async () => {
    const ctx = await team()
    await join(pool, ctx.owner2.id, ctx.org, 'OWNER')
    const response = await patch(
      request(ctx.app),
      members(ctx.org, ctx.owner.id),
      { role: 'VIEWER' },
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(200)
    expect(await ownersOf(pool, ctx.org)).toEqual([ctx.owner2.id])
  })

  it('promoting to OWNER works, and a no-op change is fine', async () => {
    const ctx = await team()
    expect(
      (
        await patch(request(ctx.app), members(ctx.org, ctx.editor.id), {
          role: 'OWNER',
        }).set('Cookie', ctx.owner.cookie)
      ).status,
    ).toBe(200)
    expect(
      (
        await patch(request(ctx.app), members(ctx.org, ctx.editor.id), {
          role: 'OWNER',
        }).set('Cookie', ctx.owner.cookie)
      ).status,
    ).toBe(200)
    expect((await ownersOf(pool, ctx.org)).sort()).toEqual(
      [ctx.owner.id, ctx.editor.id].sort(),
    )
  })

  it('only changes the role in THIS organization', async () => {
    const ctx = await team()
    const other = await organization(pool, 'other-org')
    await join(pool, ctx.viewer.id, other, 'VIEWER')
    await patch(request(ctx.app), members(ctx.org, ctx.viewer.id), {
      role: 'EDITOR',
    }).set('Cookie', ctx.owner.cookie)
    expect(await roleOf(pool, other, ctx.viewer.id)).toBe('VIEWER')
  })
})

/** Every (role, target) combination the refinedBy route is exercised with. */
const exercised = new Set<string>()

describe('DELETE /api/orgs/:orgId/members/:userId: any member may call it; the POLICY narrows it', () => {
  async function remove(
    ctx: Awaited<ReturnType<typeof team>>,
    actor: 'owner' | 'editor' | 'viewer',
    target: 'self' | 'other',
  ) {
    const actorPerson = ctx[actor]
    // "other" is a plain member the actor is allowed to see; for the owner it is the viewer.
    const otherId = actor === 'viewer' ? ctx.editor.id : ctx.viewer.id
    const targetId = target === 'self' ? actorPerson.id : otherId
    exercised.add(`${actor.toUpperCase()}:${target}`)
    return del(request(ctx.app), members(ctx.org, targetId)).set(
      'Cookie',
      actorPerson.cookie,
    )
  }

  it.each([
    ['owner', 'other', 204],
    ['owner', 'self', 409], // the only owner cannot leave
    ['editor', 'other', 403],
    ['editor', 'self', 204],
    ['viewer', 'other', 403],
    ['viewer', 'self', 204],
  ] as const)('%s removing %s -> %i', async (actor, target, status) => {
    const ctx = await team()
    const response = await remove(ctx, actor, target)
    expect(response.status).toBe(status)
  })

  it('a forbidden removal changes nothing', async () => {
    const ctx = await team()
    await remove(ctx, 'viewer', 'other')
    expect(await roleOf(pool, ctx.org, ctx.editor.id)).toBe('EDITOR')
    await remove(ctx, 'editor', 'other')
    expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('VIEWER')
  })

  it('an owner who is not the last can leave', async () => {
    const ctx = await team()
    await join(pool, ctx.owner2.id, ctx.org, 'OWNER')
    const response = await remove(ctx, 'owner', 'self')
    expect(response.status).toBe(204)
    expect(await ownersOf(pool, ctx.org)).toEqual([ctx.owner2.id])
  })

  it('removes only the membership, not the user or the other organizations', async () => {
    const ctx = await team()
    const other = await organization(pool, 'elsewhere')
    await join(pool, ctx.viewer.id, other, 'VIEWER')
    await remove(ctx, 'owner', 'other')
    expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBeNull()
    expect(await roleOf(pool, other, ctx.viewer.id)).toBe('VIEWER')
    expect(
      (await pool.query('SELECT 1 FROM "User" WHERE id = $1', [ctx.viewer.id]))
        .rowCount,
    ).toBe(1)
  })

  it('refuses to remove the last owner whoever asks (409 LAST_OWNER)', async () => {
    const ctx = await team()
    const response = await del(
      request(ctx.app),
      members(ctx.org, ctx.owner.id),
    ).set('Cookie', ctx.owner.cookie)
    expect(response.status).toBe(409)
    expect((response.body as Body).error?.code).toBe('LAST_OWNER')
    expect(await ownersOf(pool, ctx.org)).toEqual([ctx.owner.id])
  })

  it('404 for a target who is not a member (owner asking), a malformed id, or an outsider caller', async () => {
    const ctx = await team()
    for (const target of [
      ctx.outsider.id,
      '99999999-9999-4999-8999-999999999999',
      'not-a-uuid',
    ]) {
      const response = await del(
        request(ctx.app),
        members(ctx.org, target),
      ).set('Cookie', ctx.owner.cookie)
      expect(response.status, target).toBe(404)
    }
    const outsider = await del(
      request(ctx.app),
      members(ctx.org, ctx.viewer.id),
    ).set('Cookie', ctx.outsider.cookie)
    expect(outsider.status).toBe(404)
  })

  it('a removed member can no longer see the organization (404, not 403)', async () => {
    const ctx = await team()
    await remove(ctx, 'viewer', 'self')
    const response = await request(ctx.app)
      .get(members(ctx.org))
      .set('Cookie', ctx.viewer.cookie)
    expect(response.status).toBe(404)
  })

  it('has no request body to smuggle fields in: a body is rejected', async () => {
    const ctx = await team()
    const response = await request(ctx.app)
      .delete(members(ctx.org, ctx.viewer.id))
      .set('Origin', 'https://app.example.test')
      .set('Cookie', ctx.owner.cookie)
      .set('Content-Type', 'application/json')
      .send({ role: 'OWNER' })
    expect(response.status).toBe(400)
    expect(await roleOf(pool, ctx.org, ctx.viewer.id)).toBe('VIEWER')
  })
})

describe('routes narrowed by `refinedBy` have per-role tests', () => {
  it('every refinedBy route names a REAL policy function and has been exercised as every role, on self and on others', async () => {
    const ctx = await team()
    const refined = ctx.routes.filter((route) => route.refinedBy !== undefined)
    // A new refinedBy route must add its own per-role tests and be listed here.
    expect(refined.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([
      'DELETE /api/orgs/:orgId/members/:userId',
    ])
    for (const route of refined) {
      expect(route.refinedBy).toBe('canRemoveMember')
      expect(
        typeof (policy as Record<string, unknown>)[route.refinedBy ?? ''],
      ).toBe('function')
    }
    for (const role of ['OWNER', 'EDITOR', 'VIEWER']) {
      for (const target of ['self', 'other']) {
        expect(exercised, `${role}:${target}`).toContain(`${role}:${target}`)
      }
    }
  })
})
