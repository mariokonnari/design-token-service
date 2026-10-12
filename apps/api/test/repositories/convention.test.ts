import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkGlobalRepositorySource,
  checkRepositorySource,
  tenantOwnedModels,
} from '../support/repositoryConvention'

// Tenant isolation conventions, checked on the REAL repository sources, plus
// self-tests proving the checkers flag deliberately bad samples.

const API = join(import.meta.dirname, '..', '..')
const REPOSITORIES = join(API, 'src', 'repositories')
const GLOBAL = join(REPOSITORIES, 'global')
const schema = readFileSync(join(API, 'prisma', 'schema.prisma'), 'utf8')
const tenantOwned = tenantOwnedModels(schema)

const sourcesIn = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        entry.name !== 'index.ts' &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => ({
      name: entry.name,
      source: readFileSync(join(dir, entry.name), 'utf8'),
    }))

describe('where repositories may live', () => {
  it('src/repositories holds only .ts files and the global/ directory', () => {
    const odd = readdirSync(REPOSITORIES, { withFileTypes: true })
      .filter(
        (entry) =>
          !(entry.isFile() && entry.name.endsWith('.ts')) &&
          !(entry.isDirectory() && entry.name === 'global'),
      )
      .map((entry) => entry.name)
    // A repository in any other subdirectory would escape both checks below.
    expect(odd).toEqual([])
  })

  it('global/ holds only .ts files', () => {
    const odd = readdirSync(GLOBAL, { withFileTypes: true })
      .filter((entry) => !(entry.isFile() && entry.name.endsWith('.ts')))
      .map((entry) => entry.name)
    expect(odd).toEqual([])
  })

  it('derives the tenant-owned models from schema.prisma (everything but Organization, User, Membership)', () => {
    expect(tenantOwned).toEqual(
      expect.arrayContaining(['Brand', 'Token', 'Release']),
    )
    for (const name of ['Organization', 'User', 'Membership']) {
      expect(tenantOwned).not.toContain(name)
    }
  })
})

describe('the real TENANT-SCOPED repositories follow the conventions', () => {
  const reports = sourcesIn(REPOSITORIES).map(({ name, source }) => ({
    name,
    report: checkRepositorySource(name, source),
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

describe('the real GLOBAL repositories stay out of tenant data', () => {
  const reports = sourcesIn(GLOBAL).map(({ name, source }) => ({
    name,
    report: checkGlobalRepositorySource(name, source, tenantOwned),
  }))

  it('inspects at least one function (the check is not vacuous)', () => {
    const checked = reports.flatMap((r) => r.report.checked)
    expect(checked.length).toBeGreaterThanOrEqual(1)
    expect(checked).toEqual(
      expect.arrayContaining([
        'UserRepository.create',
        'UserRepository.findById',
      ]),
    )
  })

  it('has no violations: no tenant-owned model, no TenantScope', () => {
    const violations = reports.flatMap((r) =>
      r.report.violations.map((v) => `${r.name}: ${v.where}: ${v.problem}`),
    )
    expect(violations).toEqual([])
  })
})

describe('the tenant checker can fail (self-tests on bad samples)', () => {
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
    expect(
      problems(`
      export class R {
        async get(id: string, scope: TenantScope) {
          requireScope(scope)
          return this.db.brand.findFirst({ where: { id, organizationId: scope.organizationId } })
        }
      }`),
    ).toEqual([
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

  it('checks queries inside a transaction (tx.<model>.<op>)', () => {
    expect(
      problems(`
        export class R {
          async move(scope: TenantScope) {
            requireScope(scope)
            return this.db.$transaction(async (tx) => {
              await tx.membership.update({ where: { organizationId: scope.organizationId } })
              return tx.membership.findMany({ where: { role: 'OWNER' } })
            })
          }
        }`),
    ).toEqual([
      'R.move: tx.membership.findMany(...) does not mention organizationId',
    ])
  })

  it('checks raw queries: a tagged template must mention organizationId', () => {
    expect(
      problems(`
        export class R {
          async lock(scope: TenantScope) {
            requireScope(scope)
            return this.db.$transaction(async (tx) => {
              return tx.$queryRaw\`SELECT id FROM "Membership" FOR UPDATE\`
            })
          }
        }`),
    ).toEqual(['R.lock: tx.$queryRaw(...) does not mention organizationId'])
    expect(
      problems(`
        export class R {
          async lock(scope: TenantScope) {
            requireScope(scope)
            return this.db.$transaction(async (tx) => {
              return tx.$queryRaw\`SELECT id FROM "Membership" WHERE "organizationId" = \${scope.organizationId}::uuid FOR UPDATE\`
            })
          }
        }`),
    ).toEqual([])
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

describe('the global checker can fail (a tenant-scoped repository cannot hide in global/)', () => {
  const check = (body: string) =>
    checkGlobalRepositorySource('global/sample.ts', body, tenantOwned)
  const problems = (body: string) =>
    check(body).violations.map((v) => `${v.where}: ${v.problem}`)

  it('passes a repository that only touches global models', () => {
    const report = check(`
      export class U {
        async create(input: Input) { return this.db.user.create({ data: input }) }
        async list(id: string) { return this.db.membership.findMany({ where: { userId: id } }) }
        async org(id: string) { return this.db.organization.findFirst({ where: { id } }) }
      }`)
    expect(report.violations).toEqual([])
    expect(report.checked).toEqual(['U.create', 'U.list', 'U.org'])
  })

  it.each(['brand', 'token', 'release'])(
    'flags a query on the tenant-owned model %s',
    (model) => {
      expect(
        problems(`
          export class Sneaky {
            async all() { return this.db.${model}.findMany({}) }
          }`),
      ).toEqual([
        expect.stringContaining(`touches the tenant-owned model "${model}"`),
      ])
    },
  )

  it('flags a tenant-owned model reached through a transaction client', () => {
    expect(
      problems(`
        export class Sneaky {
          async all() {
            return this.db.$transaction(async (tx) => tx.token.findMany({}))
          }
        }`),
    ).toEqual([expect.stringContaining('tenant-owned model "token"')])
  })

  it('flags a raw query on a tenant-owned table', () => {
    expect(
      problems(`
        export class Sneaky {
          async all() { return this.db.$queryRaw\`SELECT * FROM "Brand"\` }
        }`),
    ).toEqual([
      'Sneaky.all: a raw query touches the tenant-owned table "Brand"',
    ])
  })

  it('flags a function that takes a TenantScope (it belongs in the tenant-scoped directory)', () => {
    expect(
      problems(`
        export class Hidden {
          async list(scope: TenantScope) {
            requireScope(scope)
            return this.db.user.findMany({ where: { organizationId: scope.organizationId } })
          }
        }`),
    ).toEqual([expect.stringContaining('takes a TenantScope')])
  })

  it('treats a NEW model as tenant-owned by default (it must be allow-listed on purpose)', () => {
    const withInvoice = tenantOwnedModels(
      `${schema}\nmodel Invoice {\n  id String @id\n}\n`,
    )
    expect(withInvoice).toContain('Invoice')
    expect(
      checkGlobalRepositorySource(
        'global/sample.ts',
        `export class S { async all() { return this.db.invoice.findMany({}) } }`,
        withInvoice,
      ).violations,
    ).toHaveLength(1)
  })
})
