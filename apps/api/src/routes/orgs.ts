import { z } from 'zod'
import { getAuth } from '../auth/authenticate'
import { getScope } from '../auth/requireOrg'
import type { MembershipLookupRepository } from '../repositories/global/memberships'
import type { OrganizationRepository } from '../repositories/global/organizations'
import type {
  MemberRecord,
  MembershipRepository,
} from '../repositories/memberships'
import { ROLES } from '../tenancy/scope'
import type { RouteDef } from './table'
import { parse, parseEmptyBody, uuidOrNotFound } from './validate'

export interface OrgRouteDeps {
  organizations: OrganizationRepository
  lookup: MembershipLookupRepository
  members: MembershipRepository
}

const createOrgBody = z.strictObject({
  name: z.string(),
  slug: z.string(),
})

const changeRoleBody = z.strictObject({
  role: z.enum(ROLES),
})

function memberView(member: MemberRecord) {
  return {
    userId: member.userId,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt,
  }
}

export function orgRoutes({
  organizations,
  lookup,
  members,
}: OrgRouteDeps): RouteDef[] {
  return [
    {
      method: 'post',
      path: '/api/orgs',
      access: 'authenticated',
      handler: async (req, res) => {
        const body = parse(createOrgBody, req.body)
        const created = await organizations.createWithOwner(
          getAuth(res).userId,
          body,
        )
        res.status(201).json({ organization: { ...created, role: 'OWNER' } })
      },
    },

    {
      method: 'get',
      path: '/api/orgs',
      access: 'authenticated',
      handler: async (_req, res) => {
        const mine = await lookup.listForUser(getAuth(res).userId)
        res.json({
          organizations: mine.map((org) => ({
            id: org.organizationId,
            slug: org.slug,
            name: org.name,
            role: org.role,
          })),
        })
      },
    },

    {
      method: 'get',
      path: '/api/orgs/:orgId/members',
      access: { orgRole: 'VIEWER' },
      handler: async (_req, res) => {
        const list = await members.list(getScope(res))
        res.json({ members: list.map(memberView) })
      },
    },

    {
      method: 'patch',
      path: '/api/orgs/:orgId/members/:userId',
      access: { orgRole: 'OWNER' },
      handler: async (req, res) => {
        const targetUserId = uuidOrNotFound(req.params['userId'])
        const { role } = parse(changeRoleBody, req.body)
        const updated = await members.changeRole(
          getScope(res),
          targetUserId,
          role,
        )
        res.json({ member: memberView(updated) })
      },
    },

    {
      // Open to every member: anyone may remove THEMSELVES. Removing someone else
      // needs an owner, which the policy function narrows (see `refinedBy`).
      method: 'delete',
      path: '/api/orgs/:orgId/members/:userId',
      access: { orgRole: 'VIEWER' },
      refinedBy: 'canRemoveMember',
      handler: async (req, res) => {
        parseEmptyBody(req.body)
        await members.remove(
          getScope(res),
          uuidOrNotFound(req.params['userId']),
        )
        res.status(204).end()
      },
    },
  ]
}
