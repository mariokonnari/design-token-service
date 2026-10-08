import { Role as PrismaRole } from '../src/generated/prisma/client'
import { describe, expect, it } from 'vitest'
import { ForbiddenError } from '../src/errors'
import { assertCanWrite, canRead, canWrite } from '../src/tenancy/policy'
import {
  ROLES,
  isTenantScope,
  issueTenantScope,
  requireScope,
  type Role,
} from '../src/tenancy/scope'

const ORG = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const scopeFor = (role: Role) =>
  issueTenantScope({ organizationId: ORG, userId: USER, role })

describe('issueTenantScope', () => {
  it('builds a frozen scope with the three fields', () => {
    const scope = scopeFor('EDITOR')
    expect(scope).toMatchObject({
      organizationId: ORG,
      userId: USER,
      role: 'EDITOR',
    })
    expect(Object.isFrozen(scope)).toBe(true)
    expect(() => {
      ;(scope as { role: string }).role = 'OWNER'
    }).toThrow(TypeError)
    expect(scope.role).toBe('EDITOR')
  })

  it.each([
    ['organizationId', { organizationId: 'nope' }],
    ['organizationId', { organizationId: '' }],
    ['userId', { userId: '1; DROP TABLE "User"' }],
    ['role', { role: 'ADMIN' }],
    ['role', { role: 'owner' }],
  ])('rejects an invalid %s', (_field, override) => {
    expect(() =>
      issueTenantScope({
        organizationId: ORG,
        userId: USER,
        role: 'OWNER',
        ...override,
      } as never),
    ).toThrow(TypeError)
  })

  it('keeps ROLES in sync with the Prisma Role enum', () => {
    expect([...ROLES].sort()).toEqual(Object.values(PrismaRole).sort())
  })
})

describe('isTenantScope and requireScope (the runtime half of the guarantee)', () => {
  it('accepts only what issueTenantScope made', () => {
    const scope = scopeFor('OWNER')
    expect(isTenantScope(scope)).toBe(true)
    expect(requireScope(scope)).toBe(scope)
  })

  it.each([
    ['a plain object', { organizationId: ORG, userId: USER, role: 'OWNER' }],
    ['a spread copy', null],
    ['a JSON round trip', null],
    ['null', null],
    ['undefined', undefined],
    ['a string', ORG],
    ['an array', [ORG, USER, 'OWNER']],
  ])('rejects a forged scope: %s', (name, value) => {
    const real = scopeFor('OWNER')
    const forged =
      name === 'a spread copy'
        ? { ...real }
        : name === 'a JSON round trip'
          ? (JSON.parse(JSON.stringify(real)) as unknown)
          : value
    expect(isTenantScope(forged)).toBe(false)
    expect(() => requireScope(forged as never)).toThrow(TypeError)
  })

  it('does not trust a lookalike with a prototype copied from a real scope', () => {
    const real = scopeFor('OWNER')
    const lookalike = Object.create(
      Object.getPrototypeOf(real) as object,
      Object.getOwnPropertyDescriptors(real),
    ) as object
    expect(isTenantScope(lookalike)).toBe(false)
  })
})

describe('the authorization policy (one place)', () => {
  it.each([
    ['OWNER', true, true],
    ['EDITOR', true, true],
    ['VIEWER', true, false],
  ] as const)('%s: canRead=%s canWrite=%s', (role, read, write) => {
    const scope = scopeFor(role)
    expect(canRead(scope)).toBe(read)
    expect(canWrite(scope)).toBe(write)
    if (write) {
      expect(() => {
        assertCanWrite(scope)
      }).not.toThrow()
    } else {
      expect(() => {
        assertCanWrite(scope)
      }).toThrow(ForbiddenError)
    }
  })

  it('treats a forged scope as no authority at all', () => {
    const forged = {
      organizationId: ORG,
      userId: USER,
      role: 'OWNER',
    } as never
    expect(() => canWrite(forged)).toThrow(TypeError)
    expect(() => {
      assertCanWrite(forged)
    }).toThrow(TypeError)
  })

  it('the ForbiddenError is typed and carries no tenant data', () => {
    try {
      assertCanWrite(scopeFor('VIEWER'))
      throw new Error('expected a throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as Error).name).toBe('ForbiddenError')
      expect((error as Error).message).not.toContain(ORG)
      expect((error as Error).message).not.toContain(USER)
    }
  })
})
