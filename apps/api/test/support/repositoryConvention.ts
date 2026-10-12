import ts from 'typescript'

/**
 * Checks the repository conventions that make tenant isolation hard to get wrong
 * (ADR 0012, 0013). It parses the source with the TypeScript compiler API.
 *
 * TENANT-SCOPED repositories (src/repositories/*.ts):
 * 1. every exported function and every PUBLIC method of an exported class takes a
 *    `TenantScope` as its first parameter;
 * 2. every such method calls `requireScope(...)`;
 * 3. every Prisma call `this.db.<model>.<op>(...)` or `tx.<model>.<op>(...)` (the
 *    transaction client is named `tx`) and every raw query tagged template mentions
 *    `organizationId`. This is a HEURISTIC on the source text: it catches a forgotten
 *    filter, not a wrong one.
 *
 * GLOBAL repositories (src/repositories/global/*.ts) serve data that is not owned by
 * a tenant (users, memberships by user, organization creation). They are checked the
 * other way round: they must NOT touch a tenant-owned model, and must not take a
 * `TenantScope` (a tenant-scoped repository cannot hide in global/).
 *
 * What it cannot do: prove a query is correct. Tests against real Postgres do that.
 */

export interface ConventionViolation {
  where: string
  problem: string
}

export interface ConventionReport {
  /** What was inspected, e.g. "BrandRepository.list". A non-empty list proves the check was not vacuous. */
  checked: string[]
  violations: ConventionViolation[]
}

const DB_CALL = /^(this\.db|tx)\.(\w+)\.(\w+)$/
const RAW_TAG = /^(this\.db|tx)\.\$(queryRaw|executeRaw)$/
const RAW_CALL = /^(this\.db|tx)\.\$(queryRawUnsafe|executeRawUnsafe)$/

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
}

function isPublicMethod(node: ts.MethodDeclaration): boolean {
  const modifiers = ts.getModifiers(node) ?? []
  return (
    !modifiers.some(
      (m) =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword,
    ) && !ts.isPrivateIdentifier(node.name)
  )
}

interface Callable {
  name: string
  parameters: readonly ts.ParameterDeclaration[]
  body: ts.Node | undefined
}

/** Every exported function and public method in the file. */
function callablesOf(file: ts.SourceFile): Callable[] {
  const out: Callable[] = []
  for (const statement of file.statements) {
    if (!isExported(statement)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      out.push({
        name: statement.name.text,
        parameters: statement.parameters,
        body: statement.body,
      })
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !isPublicMethod(member)) continue
        out.push({
          name: `${statement.name.text}.${member.name.getText(file)}`,
          parameters: member.parameters,
          body: member.body,
        })
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          out.push({
            name: declaration.name.getText(file),
            parameters: init.parameters,
            body: init.body,
          })
        }
      }
    }
  }
  return out
}

/** Calls the checks care about, found anywhere inside a body. */
interface DbUse {
  kind: 'model' | 'raw'
  /** e.g. "this.db.brand.findMany" */
  callee: string
  /** The model's client property, e.g. "brand" (model calls only). */
  model: string | undefined
  /** The argument or template text. */
  text: string
}

function dbUsesIn(body: ts.Node, file: ts.SourceFile): DbUse[] {
  const uses: DbUse[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file)
      const model = DB_CALL.exec(callee)
      if (model) {
        uses.push({
          kind: 'model',
          callee,
          model: model[2],
          text: node.arguments.map((a) => a.getText(file)).join(' '),
        })
      } else if (RAW_CALL.test(callee)) {
        uses.push({
          kind: 'raw',
          callee,
          model: undefined,
          text: node.arguments.map((a) => a.getText(file)).join(' '),
        })
      }
    } else if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag.getText(file)
      if (RAW_TAG.test(tag)) {
        uses.push({
          kind: 'raw',
          callee: tag,
          model: undefined,
          text: node.template.getText(file),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return uses
}

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
}

export function checkRepositorySource(
  fileName: string,
  source: string,
): ConventionReport {
  const file = parse(fileName, source)
  const report: ConventionReport = { checked: [], violations: [] }

  for (const { name, parameters, body } of callablesOf(file)) {
    report.checked.push(name)
    const first = parameters[0]
    if (first?.type?.getText(file) !== 'TenantScope') {
      report.violations.push({
        where: name,
        problem: `the first parameter must be typed TenantScope (found ${first === undefined ? 'no parameter' : `"${first.getText(file)}"`})`,
      })
    }
    if (body === undefined) continue
    if (!body.getText(file).includes('requireScope(')) {
      report.violations.push({
        where: name,
        problem:
          'does not call requireScope(...), so a forged scope would be accepted',
      })
    }
    for (const use of dbUsesIn(body, file)) {
      if (!use.text.includes('organizationId')) {
        report.violations.push({
          where: name,
          problem: `${use.callee}(...) does not mention organizationId`,
        })
      }
    }
  }
  return report
}

/** Models that are NOT tenant-owned: everything else in schema.prisma is. */
export const GLOBAL_MODELS = ['Organization', 'User', 'Membership'] as const

/** Tenant-owned model names from schema.prisma: every model except the global ones. */
export function tenantOwnedModels(schemaText: string): string[] {
  const names = [...schemaText.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (match) => match[1] ?? '',
  )
  return names.filter(
    (name) =>
      name !== '' && !(GLOBAL_MODELS as readonly string[]).includes(name),
  )
}

const lowerFirst = (value: string) =>
  value.charAt(0).toLowerCase() + value.slice(1)

export function checkGlobalRepositorySource(
  fileName: string,
  source: string,
  tenantOwned: readonly string[],
): ConventionReport {
  const file = parse(fileName, source)
  const report: ConventionReport = { checked: [], violations: [] }
  const ownedClientNames = new Set(tenantOwned.map(lowerFirst))

  for (const { name, parameters, body } of callablesOf(file)) {
    report.checked.push(name)
    if (parameters.some((p) => p.type?.getText(file) === 'TenantScope')) {
      report.violations.push({
        where: name,
        problem:
          'takes a TenantScope: a tenant-scoped repository belongs in src/repositories/, not in global/',
      })
    }
    if (body === undefined) continue
    for (const use of dbUsesIn(body, file)) {
      if (
        use.kind === 'model' &&
        use.model &&
        ownedClientNames.has(use.model)
      ) {
        report.violations.push({
          where: name,
          problem: `${use.callee}(...) touches the tenant-owned model "${use.model}": that belongs in a tenant-scoped repository`,
        })
      }
      if (use.kind === 'raw') {
        for (const model of tenantOwned) {
          if (use.text.includes(`"${model}"`)) {
            report.violations.push({
              where: name,
              problem: `a raw query touches the tenant-owned table "${model}"`,
            })
          }
        }
      }
    }
  }
  return report
}
