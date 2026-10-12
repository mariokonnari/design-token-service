import express from 'express'
import { describe, expect, it } from 'vitest'
import { mountRoutes } from '../../src/routes/mount'
import type { RouteDef } from '../../src/routes/table'

// A protected route must be IMPOSSIBLE to mount without its guard: the app fails
// at startup instead of silently serving it unprotected.

const handler: RouteDef['handler'] = (_req, res) => {
  res.end()
}
const guard: RouteDef['handler'] = (_req, _res, next) => {
  next()
}

describe('mountRoutes fails closed', () => {
  it('refuses an authenticated route when no authenticate guard is provided', () => {
    const route: RouteDef = {
      method: 'get',
      path: '/me',
      access: 'authenticated',
      handler,
    }
    expect(() => mountRoutes(express(), [route])).toThrow(
      /GET \/me needs authentication/,
    )
    expect(() =>
      mountRoutes(express(), [route], { requireOrg: () => guard }),
    ).toThrow(/needs authentication/)
  })

  it('refuses an org route when no requireOrg guard is provided', () => {
    const route: RouteDef = {
      method: 'get',
      path: '/orgs/:orgId/members',
      access: { orgRole: 'VIEWER' },
      handler,
    }
    expect(() =>
      mountRoutes(express(), [route], { authenticate: guard }),
    ).toThrow(/needs an organization role/)
    expect(() => mountRoutes(express(), [route])).toThrow(
      /needs authentication/,
    )
  })

  it('mounts a public route without any guard', () => {
    const route: RouteDef = {
      method: 'get',
      path: '/open',
      access: 'public',
      handler,
    }
    expect(() => mountRoutes(express(), [route])).not.toThrow()
  })

  it('mounts protected routes when the guards are provided, passing the declared role', () => {
    const roles: string[] = []
    const app = express()
    mountRoutes(
      app,
      [
        { method: 'get', path: '/a', access: 'authenticated', handler },
        {
          method: 'get',
          path: '/b/:orgId',
          access: { orgRole: 'EDITOR' },
          handler,
        },
      ],
      {
        authenticate: guard,
        requireOrg: (role) => {
          roles.push(role)
          return guard
        },
      },
    )
    expect(roles).toEqual(['EDITOR'])
  })

  it('runs `before` guards first, then access guards, then `after`, then the handler', async () => {
    const order: string[] = []
    const mark =
      (name: string): RouteDef['handler'] =>
      (_req, _res, next) => {
        order.push(name)
        next()
      }
    const app = express()
    mountRoutes(
      app,
      [
        {
          method: 'get',
          path: '/x',
          access: 'authenticated',
          before: [mark('before')],
          after: [mark('after')],
          handler: (_req, res) => {
            order.push('handler')
            res.end()
          },
        },
      ],
      { authenticate: mark('authenticate') },
    )
    const server = app.listen(0)
    try {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      await fetch(`http://127.0.0.1:${port}/x`)
    } finally {
      server.close()
    }
    expect(order).toEqual(['before', 'authenticate', 'after', 'handler'])
  })
})
