import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findReleaseMutations,
  publicMethods,
} from '../support/releaseImmutability'

// Releases are immutable (ADR 0015). The database refuses UPDATE and DELETE with a
// trigger (test/db/releaseImmutable.test.ts); these tests make sure the application
// has no code path that tries, and that the release repository's public surface can
// only grow on purpose.

const API = join(import.meta.dirname, '..', '..')
const SRC = join(API, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path)
    }
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('the release repository exposes NO update and NO delete', () => {
  const source = readFileSync(join(SRC, 'repositories', 'releases.ts'), 'utf8')

  it('its public methods are exactly the read methods and publish', () => {
    // A new public method must be added here ON PURPOSE, which makes a reviewer look.
    expect(publicMethods('releases.ts', source, 'ReleaseRepository')).toEqual([
      'get',
      'getCss',
      'list',
      'publish',
    ])
  })

  it('no public method is named like a mutation', () => {
    const mutating = publicMethods(
      'releases.ts',
      source,
      'ReleaseRepository',
    ).filter((name) =>
      /^(update|delete|remove|upsert|edit|patch|save|overwrite|rename|set|truncate|purge)/i.test(
        name,
      ),
    )
    expect(mutating).toEqual([])
  })
})

describe('no application code changes or removes a Release row', () => {
  const files = sourceFiles(SRC)

  it('inspects the real sources (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(files.some((f) => f.endsWith('releases.ts'))).toBe(true)
  })

  it('finds no release.update/upsert/delete, no nested releases write and no SQL that changes "Release"', () => {
    const problems = files.flatMap((path) =>
      findReleaseMutations(path, readFileSync(path, 'utf8')).map(
        (found) => `${relative(API, path)}: ${found}`,
      ),
    )
    expect(problems).toEqual([])
  })
})

describe('the checker can fail (self-tests on bad samples)', () => {
  const check = (code: string) => findReleaseMutations('sample.ts', code)

  it.each([
    'update',
    'updateMany',
    'updateManyAndReturn',
    'upsert',
    'delete',
    'deleteMany',
  ])('flags tx.release.%s(...) and this.db.release.%s(...)', (operation) => {
    expect(check(`tx.release.${operation}({ where: {} })`)).toHaveLength(1)
    expect(check(`this.db.release.${operation}({ where: {} })`)).toHaveLength(1)
  })

  it('does not flag reads and creates', () => {
    expect(
      check(`
        tx.release.findFirst({})
        tx.release.findMany({})
        tx.release.count({})
        tx.release.create({ data: {} })
        tx.release.aggregate({})
        tx.token.update({}); tx.token.delete({}); tx.brand.update({})`),
    ).toEqual([])
  })

  it('flags a nested relation write on releases', () => {
    expect(
      check(`tx.brand.update({ data: { releases: { deleteMany: {} } } })`),
    ).toHaveLength(1)
    expect(
      check(`tx.brand.update({ data: { releases: { create: {} } } })`),
    ).toEqual([])
  })

  it.each([
    'UPDATE "Release" SET css = $1',
    'DELETE FROM "Release" WHERE id = $1',
    'TRUNCATE TABLE "Brand", "Release" CASCADE',
    'update release set css = 1',
  ])('flags SQL: %s', (sql) => {
    expect(check(`tx.$executeRaw\`${sql}\``).length).toBeGreaterThan(0)
    expect(check(`const q = '${sql}'`).length).toBeGreaterThan(0)
  })

  it('does not flag SQL that only reads or inserts', () => {
    expect(
      check(
        `tx.$queryRaw\`SELECT * FROM "Release"\`; tx.$executeRaw\`INSERT INTO "Release" (a) VALUES (1)\``,
      ),
    ).toEqual([])
  })
})
