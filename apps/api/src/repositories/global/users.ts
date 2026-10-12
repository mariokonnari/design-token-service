import { normalizeEmail } from '../../auth/email'
import type { Db } from '../../db/client'
import { ConflictError } from '../../errors'
import { Prisma } from '../../generated/prisma/client'
import { isUuid } from '../../ids'

/**
 * Users are not owned by a tenant, so this repository takes no TenantScope (the
 * convention test checks that nothing tenant-owned is touched from global/).
 * Only `findByEmail` returns the password hash: it exists for login.
 */

export interface UserRecord {
  id: string
  email: string
  sessionVersion: number
  createdAt: Date
}

export interface UserWithHash extends UserRecord {
  passwordHash: string
}

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  sessionVersion: true,
  createdAt: true,
} as const

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  )
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    email: string
    passwordHash: string
  }): Promise<UserRecord> {
    try {
      return await this.db.user.create({
        data: {
          email: normalizeEmail(input.email),
          passwordHash: input.passwordHash,
        },
        select: PUBLIC_FIELDS,
      })
    } catch (error) {
      // The unique constraint is what decides a race between two signups: map it
      // to a 409, never let it become a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'An account with this email already exists.',
          'EMAIL_TAKEN',
        )
      }
      throw error
    }
  }

  async findByEmail(email: string): Promise<UserWithHash | null> {
    const normalized = normalizeEmail(email)
    if (normalized === '') return null
    return this.db.user.findUnique({
      where: { email: normalized },
      select: { ...PUBLIC_FIELDS, passwordHash: true },
    })
  }

  async findById(id: string): Promise<UserRecord | null> {
    if (!isUuid(id)) return null
    return this.db.user.findUnique({ where: { id }, select: PUBLIC_FIELDS })
  }

  /** Atomically increments the session version (revoking every session) and returns the new one. */
  async bumpSessionVersion(id: string): Promise<number | null> {
    if (!isUuid(id)) return null
    try {
      const user = await this.db.user.update({
        where: { id },
        data: { sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      })
      return user.sessionVersion
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }

  /**
   * Upgrades the stored hash to new scrypt parameters after a successful login. It
   * does NOT bump the session version (other sessions stay valid) and is a
   * compare-and-set: it only writes if the hash is still the one the caller read, so
   * it can never overwrite a password changed in the meantime.
   */
  async rehashPassword(
    id: string,
    expectedHash: string,
    newHash: string,
  ): Promise<boolean> {
    if (!isUuid(id)) return false
    const result = await this.db.user.updateMany({
      where: { id, passwordHash: expectedHash },
      data: { passwordHash: newHash },
    })
    return result.count === 1
  }

  /**
   * Replaces the hash AND bumps the session version in ONE statement, so a password
   * change always revokes every existing session. Returns the new session version.
   */
  async setPasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<number | null> {
    if (!isUuid(id)) return null
    try {
      const user = await this.db.user.update({
        where: { id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
        select: { sessionVersion: true },
      })
      return user.sessionVersion
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
  }
}
