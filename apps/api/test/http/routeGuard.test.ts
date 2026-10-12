import express from 'express'
import { describe, expect, it } from 'vitest'
import { APP_MIDDLEWARE } from '../../src/app'
import type { RouteDef } from '../../src/routes/table'
import { appWith } from '../support/http'
import { inspectApp } from '../support/routeGuard'

// The mounted app must contain exactly the routes in the route table and nothing
// else. The checker is proven against deliberately bad apps below.

const noop: RouteDef['handler'] = (_req, res) => {
  res.end()
}
const route = (method: RouteDef['method'], path: string): RouteDef => ({
  method,
  path,
  access: 'public',
  handler: noop,
})

describe('the real app', () => {
  it('mounts exactly the routes in the table, in the expected middleware shape', () => {
    const { app, routes } = appWith()
    const report = inspectApp(app, routes, APP_MIDDLEWARE)
    expect(report.violations).toEqual([])
    // Not vacuous.
    expect(report.mounted.length).toBeGreaterThanOrEqual(2)
    expect(report.mounted).toEqual(
      expect.arrayContaining(['GET /health', 'GET /ready']),
    )
  })

  it('fails when a route is added behind the table’s back', () => {
    const { app, routes } = appWith()
    app.get('/sneaky', noop)
    const report = inspectApp(app, routes, APP_MIDDLEWARE)
    expect(report.violations.join('\n')).toMatch(
      /GET \/sneaky is mounted but not in the route table/,
    )
  })
})

describe('the checker can fail (self-tests on bad apps)', () => {
  const expected = { before: ['a'], after: ['z'] }
  function named(name: string) {
    const fn = (_req: unknown, _res: unknown, next: () => void) => {
      next()
    }
    Object.defineProperty(fn, 'name', { value: name })
    return fn
  }
  function app(build: (a: express.Express) => void) {
    const a = express()
    a.use(named('a'))
    build(a)
    a.use(named('z'))
    return a
  }
  const report = (a: express.Express, table: RouteDef[]) =>
    inspectApp(a, table, expected).violations.join('\n')

  it('passes a correct app', () => {
    const a = app((x) => x.get('/one', noop))
    expect(report(a, [route('get', '/one')])).toBe('')
  })

  it('flags a mounted route that is not in the table', () => {
    const a = app((x) => {
      x.get('/one', noop)
      x.post('/two', noop)
    })
    expect(report(a, [route('get', '/one')])).toMatch(
      /POST \/two is mounted but not in the route table/,
    )
  })

  it('flags a table route that is not mounted', () => {
    const a = app((x) => x.get('/one', noop))
    expect(report(a, [route('get', '/one'), route('post', '/gone')])).toMatch(
      /POST \/gone is in the route table but not mounted/,
    )
  })

  it('flags the same path with a different method', () => {
    const a = app((x) => x.get('/one', noop))
    expect(report(a, [route('post', '/one')])).toMatch(
      /GET \/one is mounted but not in the route table/,
    )
  })

  it('flags app.all (many methods)', () => {
    const a = app((x) => x.all('/any', noop))
    expect(report(a, [route('get', '/any')])).toMatch(/answers \d+ methods/)
  })

  it('flags a chained route() with several methods', () => {
    const a = app((x) => x.route('/c').get(noop).put(noop))
    expect(report(a, [route('get', '/c')])).toMatch(/answers 2 methods/)
  })

  it('flags a nested router', () => {
    const a = app((x) => {
      const router = express.Router()
      router.get('/inner', noop)
      x.use('/prefix', router)
    })
    expect(report(a, [route('get', '/prefix/inner')])).toMatch(/nested router/)
  })

  it('flags an unexpected middleware before the routes', () => {
    const a = express()
    a.use(named('a'))
    a.use(named('extra'))
    a.get('/one', noop)
    a.use(named('z'))
    expect(report(a, [route('get', '/one')])).toMatch(
      /middleware before the routes is \[a, extra\]/,
    )
  })

  it('flags an unexpected middleware after the routes', () => {
    const a = app((x) => x.get('/one', noop))
    a.use(named('late'))
    expect(report(a, [route('get', '/one')])).toMatch(
      /middleware after the routes is \[z, late\]/,
    )
  })

  it('flags a route mounted after the error handlers', () => {
    const a = app((x) => x.get('/one', noop))
    a.get('/late', noop)
    expect(report(a, [route('get', '/one'), route('get', '/late')])).toMatch(
      /mounted after the error handlers/,
    )
  })

  it('flags a duplicate route and a duplicate table entry', () => {
    const a = app((x) => {
      x.get('/one', noop)
      x.get('/one', noop)
    })
    expect(report(a, [route('get', '/one')])).toMatch(/mounted more than once/)
    const b = app((x) => x.get('/one', noop))
    expect(report(b, [route('get', '/one'), route('get', '/one')])).toMatch(
      /lists a route more than once/,
    )
  })
})
