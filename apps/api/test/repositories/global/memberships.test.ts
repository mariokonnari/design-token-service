import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../../src/db/client'
import { MembershipLookupRepository } from '../../../src/repositories/global/memberships'
import { insert, makeOrg, makeUser } from '../../db/helpers'
import { useDatabase } from '../../support/db'
import { assertTestDatabase } from '../../support/guard'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))
const memberships = new MembershipLookupRepository(db)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

async function join(userId: unknown, orgId: unknown, role: string) {
  await insert(pool, 'Membership', { userId, organizationId: orgId, role })
}

describe('findMembership(userId, organizationId)', () => {
  it('returns the role for a member', async () => {
    const user = await makeUser(pool)
    const org = await makeOrg(pool)
    await join(user['id'], org['id'], 'EDITOR')
    expect(
      await memberships.findMembership(String(user['id']), String(org['id'])),
    ).toEqual({
      role: 'EDITOR',
    })
  })

  it('returns null for a non-member, an unknown org and an unknown user: the same answer', async () => {
    const user = await makeUser(pool)
    const other = await makeUser(pool)
    const org = await makeOrg(pool)
    await join(other['id'], org['id'], 'OWNER')
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(
      await memberships.findMembership(String(user['id']), String(org['id'])),
    ).toBeNull()
    expect(
      await memberships.findMembership(String(user['id']), missing),
    ).toBeNull()
    expect(
      await memberships.findMembership(missing, String(org['id'])),
    ).toBeNull()
  })

  it.each(['', 'abc', "1' OR '1'='1", '00000000-0000-4000-8000-00000000000g'])(
    'returns null (not an error) for the malformed id %j',
    async (bad) => {
      const user = await makeUser(pool)
      const org = await makeOrg(pool)
      expect(
        await memberships.findMembership(String(user['id']), bad),
      ).toBeNull()
      expect(
        await memberships.findMembership(bad, String(org['id'])),
      ).toBeNull()
    },
  )

  it('only sees the membership of THAT user in THAT organization', async () => {
    const a = await makeUser(pool)
    const b = await makeUser(pool)
    const org1 = await makeOrg(pool)
    const org2 = await makeOrg(pool)
    await join(a['id'], org1['id'], 'OWNER')
    await join(b['id'], org2['id'], 'VIEWER')
    expect(
      await memberships.findMembership(String(a['id']), String(org2['id'])),
    ).toBeNull()
    expect(
      await memberships.findMembership(String(b['id']), String(org1['id'])),
    ).toBeNull()
  })
})

describe('listForUser(userId)', () => {
  it("lists only the user's organizations with their role, ordered by slug", async () => {
    const user = await makeUser(pool)
    const other = await makeUser(pool)
    const zeta = await makeOrg(pool, { slug: 'zeta', name: 'Zeta' })
    const alpha = await makeOrg(pool, { slug: 'alpha', name: 'Alpha' })
    const hidden = await makeOrg(pool, { slug: 'hidden', name: 'Hidden' })
    await join(user['id'], zeta['id'], 'VIEWER')
    await join(user['id'], alpha['id'], 'OWNER')
    await join(other['id'], hidden['id'], 'OWNER')
    const list = await memberships.listForUser(String(user['id']))
    expect(list).toEqual([
      {
        organizationId: alpha['id'],
        slug: 'alpha',
        name: 'Alpha',
        role: 'OWNER',
      },
      {
        organizationId: zeta['id'],
        slug: 'zeta',
        name: 'Zeta',
        role: 'VIEWER',
      },
    ])
  })

  it('returns an empty list for a user with none, an unknown user and a malformed id', async () => {
    const user = await makeUser(pool)
    expect(await memberships.listForUser(String(user['id']))).toEqual([])
    expect(
      await memberships.listForUser('00000000-0000-4000-8000-000000000000'),
    ).toEqual([])
    expect(await memberships.listForUser('nope')).toEqual([])
  })
})
