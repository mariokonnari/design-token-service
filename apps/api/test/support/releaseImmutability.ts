import ts from 'typescript'

/**
 * Release immutability at the SOURCE level (ADR 0015). The database refuses UPDATE and
 * DELETE on "Release" with a trigger; this check makes sure the application code never
 * even tries. It parses a source file with the TypeScript compiler API and reports:
 *  - a Prisma call that changes or removes releases: `<x>.release.update|updateMany|
 *    upsert|delete|deleteMany|updateManyAndReturn(...)`;
 *  - a nested relation write on `releases` (`{ releases: { update | delete | ... } }`);
 *  - any string or template that holds SQL changing the table: UPDATE "Release",
 *    DELETE FROM "Release", TRUNCATE ... "Release".
 * It is a heuristic on source text (a query built from pieces would escape it); the
 * trigger is the real guard, and the database tests prove the trigger.
 */

const FORBIDDEN_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])

const SQL_CHANGING_RELEASE =
  /\b(UPDATE\s+"?Release"?\b|DELETE\s+FROM\s+"?Release"?\b|TRUNCATE\b[^;]*"Release")/i

export function findReleaseMutations(
  fileName: string,
  source: string,
): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (
        ts.isPropertyAccessExpression(callee) &&
        FORBIDDEN_OPERATIONS.has(callee.name.text) &&
        /(^|\.)release$/.test(callee.expression.getText(file))
      ) {
        found.push(`${callee.getText(file)}(...)`)
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'releases' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) ||
            ts.isStringLiteral(property.name)) &&
          FORBIDDEN_OPERATIONS.has(property.name.text)
        ) {
          found.push(`releases: { ${property.name.text} ... } (nested write)`)
        }
      }
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      SQL_CHANGING_RELEASE.test(node.text)
    ) {
      found.push(`SQL: ${node.text.trim().slice(0, 60)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** The public (non-private, non-protected) method names of an exported class. */
export function publicMethods(
  fileName: string,
  source: string,
  className: string,
): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
  )
  const names: string[] = []
  for (const statement of file.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name?.text !== className)
      continue
    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue
      const modifiers = ts.getModifiers(member) ?? []
      const hidden = modifiers.some(
        (m) =>
          m.kind === ts.SyntaxKind.PrivateKeyword ||
          m.kind === ts.SyntaxKind.ProtectedKeyword,
      )
      if (!hidden && !ts.isPrivateIdentifier(member.name)) {
        names.push(member.name.getText(file))
      }
    }
  }
  return names.sort()
}
