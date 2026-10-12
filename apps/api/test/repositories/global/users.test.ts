import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaClient } from '../../../src/db/client'
import { ConflictError } from '../../../src/errors'
import { UserRepository } from '../../../src/repositories/global/users'
import { makeUser } from '../../db/helpers'
import { useDatabase } from '../../support/db'
import { assertTestDatabase } from '../../support/guard'

const { pool } = useDatabase()
const db = createPrismaClient(assertTestDatabase(process.env['DATABASE_URL']))
const users = new UserRepository(db)

beforeAll(async () => {
  await db.$connect()
})
afterAll(async () => {
  await db.$disconnect()
})

const HASH =
  'scrypt$N=1024,r=8,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('UserRepository.create', () => {
  it('creates a user and returns it WITHOUT the hash', async () => {
    const user = await users.create({
      email: 'new@example.com',
      passwordHash: HASH,
    })
    expect(Object.keys(user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'sessionVersion',
    ])
    expect(user).toMatchObject({ email: 'new@example.com', sessionVersion: 0 })
    const stored = await pool.query(
      'SELECT "passwordHash" FROM "User" WHERE id = $1',
      [user.id],
    )
    expect(stored.rows[0]).toEqual({ passwordHash: HASH })
  })

  it('lowercases and trims the email (the database stores it lowercase)', async () => {
    const user = await users.create({
      email: '  Mixed.Case@Example.COM ',
      passwordHash: HASH,
    })
    expect(user.email).toBe('mixed.case@example.com')
  })

  it('maps a duplicate email to ConflictError EMAIL_TAKEN, whatever its case', async () => {
    await users.create({ email: 'dup@example.com', passwordHash: HASH })
    for (const email of [
      'dup@example.com',
      'DUP@example.com',
      ' Dup@Example.com',
    ]) {
      const error = await users.create({ email, passwordHash: HASH }).then(
        () => undefined,
        (caught: unknown) => caught,
      )
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).code).toBe('EMAIL_TAKEN')
    }
    expect((await pool.query('SELECT 1 FROM "User"')).rowCount).toBe(1)
  })
})

describe('UserRepository.findByEmail', () => {
  it('finds a user by email in any case and includes the hash (for login)', async () => {
    const made = await users.create({
      email: 'login@example.com',
      passwordHash: HASH,
    })
    const found = await users.findByEmail('LOGIN@example.com ')
    expect(found).toMatchObject({
      id: made.id,
      email: 'login@example.com',
      passwordHash: HASH,
    })
  })

  it('returns null for an unknown email', async () => {
    expect(await users.findByEmail('nobody@example.com')).toBeNull()
    expect(await users.findByEmail('')).toBeNull()
  })
})

describe('UserRepository.findById', () => {
  it('returns the user without the hash', async () => {
    const made = await makeUser(pool)
    const found = await users.findById(String(made['id']))
    expect(found).toMatchObject({
      id: made['id'],
      email: made['email'],
      sessionVersion: 0,
    })
    expect(Object.keys(found ?? {})).not.toContain('passwordHash')
  })

  it.each(['', 'abc', "1' OR '1'='1", '00000000-0000-4000-8000-00000000000g'])(
    'returns null for the malformed id %j',
    async (id) => {
      expect(await users.findById(id)).toBeNull()
    },
  )

  it('returns null for a well-formed id that does not exist', async () => {
    expect(
      await users.findById('00000000-0000-4000-8000-000000000000'),
    ).toBeNull()
  })
})

describe('UserRepository.bumpSessionVersion', () => {
  it('increments and returns the new version', async () => {
    const made = await makeUser(pool)
    expect(await users.bumpSessionVersion(String(made['id']))).toBe(1)
    expect(await users.bumpSessionVersion(String(made['id']))).toBe(2)
    expect((await users.findById(String(made['id'])))?.sessionVersion).toBe(2)
  })

  it('is atomic under concurrency: 25 parallel bumps give exactly 25', async () => {
    const made = await makeUser(pool)
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        users.bumpSessionVersion(String(made['id'])),
      ),
    )
    expect(new Set(results).size).toBe(25)
    expect((await users.findById(String(made['id'])))?.sessionVersion).toBe(25)
  })

  it('returns null for a missing or malformed id', async () => {
    expect(
      await users.bumpSessionVersion('00000000-0000-4000-8000-000000000000'),
    ).toBeNull()
    expect(await users.bumpSessionVersion('nope')).toBeNull()
  })
})

describe('UserRepository.rehashPassword (the parameter upgrade on login)', () => {
  it('replaces the hash WITHOUT bumping the session version', async () => {
    const made = await makeUser(pool, { passwordHash: 'old' })
    expect(
      await users.rehashPassword(String(made['id']), 'old', 'upgraded'),
    ).toBe(true)
    const row = await pool.query(
      'SELECT "passwordHash", "sessionVersion" FROM "User" WHERE id = $1',
      [made['id']],
    )
    expect(row.rows[0]).toEqual({ passwordHash: 'upgraded', sessionVersion: 0 })
  })

  it('is a compare-and-set: it does nothing if the stored hash changed in the meantime', async () => {
    const made = await makeUser(pool, { passwordHash: 'current' })
    // A concurrent password change already replaced the hash this caller read.
    expect(
      await users.rehashPassword(String(made['id']), 'stale', 'upgraded'),
    ).toBe(false)
    const row = await pool.query(
      'SELECT "passwordHash" FROM "User" WHERE id = $1',
      [made['id']],
    )
    expect(row.rows[0]).toEqual({ passwordHash: 'current' })
  })

  it('returns false for a missing or malformed id', async () => {
    expect(
      await users.rehashPassword(
        '00000000-0000-4000-8000-000000000000',
        'a',
        'b',
      ),
    ).toBe(false)
    expect(await users.rehashPassword('nope', 'a', 'b')).toBe(false)
  })
})

describe('UserRepository.setPasswordHash', () => {
  it('replaces the hash AND bumps the session version in one statement', async () => {
    const made = await makeUser(pool, { passwordHash: 'old' })
    const version = await users.setPasswordHash(String(made['id']), HASH)
    expect(version).toBe(1)
    const row = await pool.query(
      'SELECT "passwordHash", "sessionVersion" FROM "User" WHERE id = $1',
      [made['id']],
    )
    expect(row.rows[0]).toEqual({ passwordHash: HASH, sessionVersion: 1 })
  })

  it('returns null for a missing or malformed id and changes nothing', async () => {
    const made = await makeUser(pool, { passwordHash: 'keep' })
    expect(
      await users.setPasswordHash('00000000-0000-4000-8000-000000000000', HASH),
    ).toBeNull()
    expect(await users.setPasswordHash('nope', HASH)).toBeNull()
    const row = await pool.query(
      'SELECT "passwordHash" FROM "User" WHERE id = $1',
      [made['id']],
    )
    expect(row.rows[0]).toEqual({ passwordHash: 'keep' })
  })
})
