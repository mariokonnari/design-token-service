import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkRepositorySource } from '../support/repositoryConvention'

// Tenant isolation conventions, checked on the REAL repository sources, plus
// self-tests proving the checker flags deliberately bad samples.

const REPOSITORIES = join(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'repositories',
)
const files = readdirSync(REPOSITORIES).filter(
  (name) =>
    name.endsWith('.ts') && name !== 'index.ts' && !name.endsWith('.test.ts'),
)

describe('the real repositories follow the conventions', () => {
  const reports = files.map((name) => ({
    name,
    report: checkRepositorySource(
      name,
      readFileSync(join(REPOSITORIES, name), 'utf8'),
    ),
  }))

  it('inspects at least one function (the check is not vacuous)', () => {
    const checked = reports.flatMap((r) => r.report.checked)
    expect(checked.length).toBeGreaterThanOrEqual(1)
    expect(checked).toEqual(
      expect.arrayContaining([
        'BrandRepository.list',
        'BrandRepository.get',
        'BrandRepository.create',
      ]),
    )
  })

  it('has no violations: TenantScope first, requireScope called, organizationId in every query', () => {
    const violations = reports.flatMap((r) =>
      r.report.violations.map((v) => `${r.name}: ${v.where}: ${v.problem}`),
    )
    expect(violations).toEqual([])
  })
})

describe('the checker can fail (self-tests on bad samples)', () => {
  const check = (body: string) => checkRepositorySource('sample.ts', body)
  const problems = (body: string) =>
    check(body).violations.map((v) => `${v.where}: ${v.problem}`)

  const good = `
    export class R {
      constructor(private readonly db: Db) {}
      async list(scope: TenantScope) {
        requireScope(scope)
        return this.db.brand.findMany({ where: { organizationId: scope.organizationId } })
      }
    }`

  it('passes a correct sample and reports what it inspected', () => {
    const report = check(good)
    expect(report.violations).toEqual([])
    expect(report.checked).toEqual(['R.list'])
  })

  it('flags a method whose first parameter is not a TenantScope', () => {
    const found = problems(`
      export class R {
        async get(id: string, scope: TenantScope) {
          requireScope(scope)
          return this.db.brand.findFirst({ where: { id, organizationId: scope.organizationId } })
        }
      }`)
    expect(found).toEqual([
      expect.stringContaining(
        'R.get: the first parameter must be typed TenantScope',
      ),
    ])
  })

  it('flags a method with no parameters and an exported function taking only a db', () => {
    expect(
      problems(`export class R { async all() { requireScope(x) } }`),
    ).toEqual([expect.stringContaining('no parameter')])
    expect(
      problems(`export function listAll(db: Db) { requireScope(db) }`),
    ).toEqual([expect.stringContaining('listAll: the first parameter')])
  })

  it('flags an exported arrow function the same way', () => {
    expect(
      problems(`export const find = (id: string) => { requireScope(id) }`),
    ).toEqual([expect.stringContaining('find: the first parameter')])
  })

  it('flags a query that forgets organizationId', () => {
    expect(
      problems(`
        export class R {
          async get(scope: TenantScope, id: string) {
            requireScope(scope)
            return this.db.brand.findFirst({ where: { id } })
          }
        }`),
    ).toEqual([
      'R.get: this.db.brand.findFirst(...) does not mention organizationId',
    ])
  })

  it('flags a method that does not call requireScope', () => {
    expect(
      problems(`
        export class R {
          async list(scope: TenantScope) {
            return this.db.brand.findMany({ where: { organizationId: scope.organizationId } })
          }
        }`),
    ).toEqual([expect.stringContaining('does not call requireScope')])
  })

  it('ignores private and protected helpers, the constructor and non-exported code', () => {
    const report = check(`
      export class R {
        constructor(private readonly db: Db) {}
        private async helper(id: string) { return id }
        protected other() { return 1 }
        async list(scope: TenantScope) {
          requireScope(scope)
          return this.db.brand.findMany({ where: { organizationId: scope.organizationId } })
        }
      }
      class Internal { async bad(id: string) { return id } }
      function internal(id: string) { return id }`)
    expect(report.violations).toEqual([])
    expect(report.checked).toEqual(['R.list'])
  })

  it('reports nothing inspected for a file with no exports (so an emptied repository cannot pass silently)', () => {
    expect(check(`const x = 1`).checked).toEqual([])
  })
})
