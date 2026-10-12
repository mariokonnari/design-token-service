import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../src/api/client'
import { createEndpoints } from '../src/api/endpoints'

// The typed endpoint functions: the exact method, path and body each one sends.
// A recording client stands in for fetch, so these pin the contract with the API.

function recorder(reply: unknown = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const client: ApiClient = {
    get: (path) => {
      calls.push({ method: 'GET', path })
      return Promise.resolve(reply as never)
    },
    post: (path, body) => {
      calls.push({
        method: 'POST',
        path,
        ...(body === undefined ? {} : { body }),
      })
      return Promise.resolve(reply as never)
    },
  }
  return { api: createEndpoints(client), calls }
}

const ORG = '0b0a6b2e-6f41-4a43-8d3f-5f7d2f2b6a11'
const BRAND = '9c1c1a80-1c0e-4d7a-b4f4-0d3b6f6e6a22'

describe('endpoints', () => {
  it('signup and login POST the credentials and return the user', async () => {
    const user = { id: 'u', email: 'a@b.c', createdAt: 't' }
    const { api, calls } = recorder({ user })
    expect(await api.signup({ email: 'a@b.c', password: 'pw' })).toEqual(user)
    expect(await api.login({ email: 'a@b.c', password: 'pw' })).toEqual(user)
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/auth/signup',
        body: { email: 'a@b.c', password: 'pw' },
      },
      {
        method: 'POST',
        path: '/api/auth/login',
        body: { email: 'a@b.c', password: 'pw' },
      },
    ])
  })

  it('logout is a bodiless POST', async () => {
    const { api, calls } = recorder(undefined)
    await api.logout()
    expect(calls).toEqual([{ method: 'POST', path: '/api/auth/logout' }])
  })

  it('me, organizations and brands are GETs that unwrap the envelope', async () => {
    expect(await recorder({ user: { id: 'u' } }).api.me()).toEqual({ id: 'u' })
    expect(
      await recorder({ organizations: [1] }).api.listOrganizations(),
    ).toEqual([1])
    const brands = recorder({ brands: [2] })
    expect(await brands.api.listBrands(ORG)).toEqual([2])
    expect(brands.calls).toEqual([
      { method: 'GET', path: `/api/orgs/${ORG}/brands` },
    ])
    const one = recorder({ brand: { id: BRAND } })
    expect(await one.api.getBrand(ORG, BRAND)).toEqual({ id: BRAND })
    expect(one.calls[0]?.path).toBe(`/api/orgs/${ORG}/brands/${BRAND}`)
  })

  it('creates send only name and slug', async () => {
    const org = recorder({ organization: { id: ORG } })
    await org.api.createOrganization({ name: 'A', slug: 'a' })
    expect(org.calls).toEqual([
      { method: 'POST', path: '/api/orgs', body: { name: 'A', slug: 'a' } },
    ])
    const brand = recorder({ brand: { id: BRAND } })
    await brand.api.createBrand(ORG, { name: 'B', slug: 'b' })
    expect(brand.calls).toEqual([
      {
        method: 'POST',
        path: `/api/orgs/${ORG}/brands`,
        body: { name: 'B', slug: 'b' },
      },
    ])
  })

  it('URL-encodes ids so a hostile route parameter cannot change the path', async () => {
    const { api, calls } = recorder({ brands: [], brand: {} })
    await api.listBrands('../me')
    await api.getBrand('a/b', '?x=1#y')
    expect(calls[0]?.path).toBe('/api/orgs/..%2Fme/brands')
    expect(calls[1]?.path).toBe('/api/orgs/a%2Fb/brands/%3Fx%3D1%23y')
  })

  it('does not pass extra properties of the form values to the API (strict bodies)', async () => {
    const { api, calls } = recorder({ organization: {} })
    const withExtra = { name: 'A', slug: 'a', role: 'OWNER' }
    await api.createOrganization(withExtra)
    expect(calls[0]?.body).toEqual({ name: 'A', slug: 'a' })
  })
})
