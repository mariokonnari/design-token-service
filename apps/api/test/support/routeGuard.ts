import type { Express } from 'express'
import type { RouteDef } from '../../src/routes/table'

/**
 * Inspects a mounted Express 5 app and reports anything that is not in the route
 * table (ADR 0013). It works on `app.router.stack`. That is only reliable because
 * every route is registered at the TOP level with its full path: a nested router's
 * mount prefix cannot be recovered in Express 5, so a nested router is itself a
 * violation here.
 *
 * Expected shape of the stack:  [ ...middleware before ][ ...route layers ][ ...middleware after ]
 */

interface Layer {
  name: string
  route?: { path: unknown; methods: Record<string, boolean> }
  handle?: { stack?: unknown }
}

export interface GuardExpectation {
  before: readonly string[]
  after: readonly string[]
}

export interface GuardReport {
  violations: string[]
  /** "GET /health" style keys of the mounted routes, in order. */
  mounted: string[]
}

const key = (method: string, path: string) => `${method.toUpperCase()} ${path}`

export function inspectApp(
  app: Express,
  table: readonly RouteDef[],
  expected: GuardExpectation,
): GuardReport {
  const stack = (app.router as unknown as { stack: Layer[] }).stack
  const violations: string[] = []
  const mounted: string[] = []
  const before: string[] = []
  const after: string[] = []
  let seenRoute = false

  for (const layer of stack) {
    if (layer.route) {
      seenRoute = true
      const { path, methods } = layer.route
      const names = Object.keys(methods).filter((m) => methods[m])
      if (typeof path !== 'string') {
        violations.push(`a route has a non-string path (${typeof path})`)
        continue
      }
      if (names.length !== 1) {
        violations.push(
          `route ${path} answers ${names.length} methods (app.all or a chained route is not allowed)`,
        )
        continue
      }
      mounted.push(key(names[0] ?? '', path))
      if (after.length > 0) {
        violations.push(`route ${path} is mounted after the error handlers`)
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      violations.push(
        'a nested router is mounted (its routes cannot be verified: register full paths at the top level)',
      )
    } else if (seenRoute) {
      after.push(layer.name)
    } else {
      before.push(layer.name)
    }
  }

  if (JSON.stringify(before) !== JSON.stringify(expected.before)) {
    violations.push(
      `middleware before the routes is [${before.join(', ')}], expected [${expected.before.join(', ')}]`,
    )
  }
  if (JSON.stringify(after) !== JSON.stringify(expected.after)) {
    violations.push(
      `middleware after the routes is [${after.join(', ')}], expected [${expected.after.join(', ')}]`,
    )
  }

  const declared = table.map((route) => key(route.method, route.path))
  for (const mountedKey of mounted) {
    if (!declared.includes(mountedKey)) {
      violations.push(`${mountedKey} is mounted but not in the route table`)
    }
  }
  for (const declaredKey of declared) {
    if (!mounted.includes(declaredKey)) {
      violations.push(`${declaredKey} is in the route table but not mounted`)
    }
  }
  if (new Set(mounted).size !== mounted.length) {
    violations.push('a route is mounted more than once')
  }
  if (new Set(declared).size !== declared.length) {
    violations.push('the route table lists a route more than once')
  }
  return { violations, mounted }
}
