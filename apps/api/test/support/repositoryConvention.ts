import ts from 'typescript'

/**
 * Checks the repository conventions that make tenant isolation hard to get wrong
 * (ADR 0012). It parses the source with the TypeScript compiler API:
 *
 * 1. every exported function and every PUBLIC method of an exported class takes a
 *    `TenantScope` as its first parameter;
 * 2. every such method calls `requireScope(...)` (the runtime check that rejects
 *    a forged scope);
 * 3. every Prisma call `this.db.<model>.<operation>(...)` mentions `organizationId`
 *    in its arguments. This last rule is a HEURISTIC on the source text: it catches
 *    a forgotten filter, not a wrong one.
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

const DB_CALL = /^this\.db\.\w+\.\w+$/

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

export function checkRepositorySource(
  fileName: string,
  source: string,
): ConventionReport {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const report: ConventionReport = { checked: [], violations: [] }

  function checkCallable(
    name: string,
    parameters: readonly ts.ParameterDeclaration[],
    body: ts.Node | undefined,
  ): void {
    report.checked.push(name)
    const first = parameters[0]
    const firstType = first?.type?.getText(file)
    if (firstType !== 'TenantScope') {
      report.violations.push({
        where: name,
        problem: `the first parameter must be typed TenantScope (found ${first === undefined ? 'no parameter' : `"${first.getText(file)}"`})`,
      })
    }
    if (body === undefined) return
    if (!body.getText(file).includes('requireScope(')) {
      report.violations.push({
        where: name,
        problem:
          'does not call requireScope(...), so a forged scope would be accepted',
      })
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(file)
        if (DB_CALL.test(callee)) {
          const args = node.arguments.map((a) => a.getText(file)).join(' ')
          if (!args.includes('organizationId')) {
            report.violations.push({
              where: name,
              problem: `${callee}(...) does not mention organizationId`,
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
  }

  for (const statement of file.statements) {
    if (!isExported(statement)) continue

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      checkCallable(statement.name.text, statement.parameters, statement.body)
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const className = statement.name.text
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !isPublicMethod(member)) continue
        checkCallable(
          `${className}.${member.name.getText(file)}`,
          member.parameters,
          member.body,
        )
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          checkCallable(
            declaration.name.getText(file),
            init.parameters,
            init.body,
          )
        }
      }
    }
  }
  return report
}
