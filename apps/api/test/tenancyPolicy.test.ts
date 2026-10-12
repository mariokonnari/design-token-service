import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../src/errors'
import {
  assertAtLeast,
  assertCanChangeVisibility,
  assertCanManageMembers,
  assertCanRemoveMember,
  canChangeVisibility,
  canManageMembers,
  canRemoveMember,
  hasRoleAtLeast,
} from '../src/tenancy/policy'
import { ROLES, issueTenantScope, type Role } from '../src/tenancy/scope'

// Member-management rules live in ONE place (tenancy/policy.ts). Every role is tested.

const ORG = '11111111-1111-4111-8111-111111111111'
const ME = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const scopeFor = (role: Role) =>
  issueTenantScope({ organizationId: ORG, userId: ME, role })

describe('hasRoleAtLeast / assertAtLeast (VIEWER < EDITOR < OWNER)', () => {
  const table: [Role, Role, boolean][] = [
    ['VIEWER', 'VIEWER', true],
    ['VIEWER', 'EDITOR', false],
    ['VIEWER', 'OWNER', false],
    ['EDITOR', 'VIEWER', true],
    ['EDITOR', 'EDITOR', true],
    ['EDITOR', 'OWNER', false],
    ['OWNER', 'VIEWER', true],
    ['OWNER', 'EDITOR', true],
    ['OWNER', 'OWNER', true],
  ]

  it.each(table)(
    '%s against a minimum of %s is %s',
    (actual, minimum, allowed) => {
      expect(hasRoleAtLeast(scopeFor(actual), minimum)).toBe(allowed)
      if (allowed) {
        expect(() => {
          assertAtLeast(scopeFor(actual), minimum)
        }).not.toThrow()
      } else {
        expect(() => {
          assertAtLeast(scopeFor(actual), minimum)
        }).toThrow(ForbiddenError)
      }
    },
  )

  it('covers every role pair', () => {
    expect(table).toHaveLength(ROLES.length * ROLES.length)
  })
})

describe('member management', () => {
  it.each([
    ['OWNER', true],
    ['EDITOR', false],
    ['VIEWER', false],
  ] as const)('%s: canManageMembers=%s', (role, allowed) => {
    expect(canManageMembers(scopeFor(role))).toBe(allowed)
    if (allowed) {
      expect(() => {
        assertCanManageMembers(scopeFor(role))
      }).not.toThrow()
    } else {
      expect(() => {
        assertCanManageMembers(scopeFor(role))
      }).toThrow(ForbiddenError)
    }
  })

  it.each([
    ['OWNER', 'another member', OTHER, true],
    ['OWNER', 'themselves', ME, true],
    ['EDITOR', 'another member', OTHER, false],
    ['EDITOR', 'themselves', ME, true],
    ['VIEWER', 'another member', OTHER, false],
    ['VIEWER', 'themselves', ME, true],
  ] as const)('%s removing %s: allowed=%s', (role, _who, target, allowed) => {
    expect(canRemoveMember(scopeFor(role), target)).toBe(allowed)
    if (allowed) {
      expect(() => {
        assertCanRemoveMember(scopeFor(role), target)
      }).not.toThrow()
    } else {
      expect(() => {
        assertCanRemoveMember(scopeFor(role), target)
      }).toThrow(ForbiddenError)
    }
  })

  it('compares user ids exactly (case matters only as the database stores them)', () => {
    expect(canRemoveMember(scopeFor('VIEWER'), ME.toUpperCase())).toBe(true)
    expect(canRemoveMember(scopeFor('VIEWER'), `${ME} `)).toBe(false)
  })

  it('a forged scope has no authority in any policy function', () => {
    const forged = { organizationId: ORG, userId: ME, role: 'OWNER' } as never
    expect(() => hasRoleAtLeast(forged, 'VIEWER')).toThrow(TypeError)
    expect(() => canManageMembers(forged)).toThrow(TypeError)
    expect(() => canRemoveMember(forged, OTHER)).toThrow(TypeError)
    expect(() => canChangeVisibility(forged)).toThrow(TypeError)
  })
})

describe('brand visibility is an owner decision', () => {
  it.each([
    ['OWNER', true],
    ['EDITOR', false],
    ['VIEWER', false],
  ] as const)('%s: allowed = %s', (role, allowed) => {
    expect(canChangeVisibility(scopeFor(role))).toBe(allowed)
    if (allowed) {
      expect(() => assertCanChangeVisibility(scopeFor(role))).not.toThrow()
    } else {
      expect(() => assertCanChangeVisibility(scopeFor(role))).toThrow(
        ForbiddenError,
      )
    }
  })
})
