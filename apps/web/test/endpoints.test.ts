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
    put: (path, body) => {
      calls.push({
        method: 'PUT',
        path,
        ...(body === undefined ? {} : { body }),
      })
      return Promise.resolve(reply as never)
    },
    del: (path) => {
      calls.push({ method: 'DELETE', path })
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

  describe('draft tokens (ADR 0014)', () => {
    const TOKENS = `/api/orgs/${ORG}/brands/${BRAND}/tokens`

    it('listTokens is a GET and returns the whole envelope', async () => {
      const reply = { draftRevision: 3, tokens: [] }
      const { api, calls } = recorder(reply)
      expect(await api.listTokens(ORG, BRAND)).toEqual(reply)
      expect(calls).toEqual([{ method: 'GET', path: TOKENS }])
    })

    it('putToken creates WITHOUT an expectedVersion key and with named fields only', async () => {
      const { api, calls } = recorder({
        token: {},
        draftRevision: 1,
        warnings: [],
      })
      await api.putToken(ORG, BRAND, {
        path: 'primitive.color.blue',
        type: 'color',
        value: { colorSpace: 'srgb', components: [0, 0, 1] },
        description: 'Blue',
        // @ts-expect-error a stray property must never reach the strict API body
        role: 'OWNER',
      })
      expect(calls).toEqual([
        {
          method: 'PUT',
          path: `${TOKENS}/primitive.color.blue`,
          body: {
            type: 'color',
            value: { colorSpace: 'srgb', components: [0, 0, 1] },
            description: 'Blue',
          },
        },
      ])
      expect(Object.keys(calls[0]?.body as object)).not.toContain(
        'expectedVersion',
      )
    })

    it('putToken updates WITH expectedVersion, and leaves out type and description when not given (an alias)', async () => {
      const { api, calls } = recorder({
        token: {},
        draftRevision: 2,
        warnings: [],
      })
      await api.putToken(ORG, BRAND, {
        path: 'semantic.color.action',
        value: '{primitive.color.blue}',
        expectedVersion: 7,
      })
      expect(calls[0]?.body).toEqual({
        value: '{primitive.color.blue}',
        expectedVersion: 7,
      })
    })

    it('deleteToken sends the version in the QUERY, never in a body', async () => {
      const { api, calls } = recorder({ draftRevision: 4 })
      expect(await api.deleteToken(ORG, BRAND, 'a.b', 3)).toEqual({
        draftRevision: 4,
      })
      expect(calls).toEqual([
        { method: 'DELETE', path: `${TOKENS}/a.b?expectedVersion=3` },
      ])
    })

    it('encodes the token path and the version so a hostile value cannot change the route', async () => {
      const { api, calls } = recorder({
        token: {},
        draftRevision: 1,
        warnings: [],
      })
      await api.putToken(ORG, BRAND, { path: '../x?y#z', value: 1 })
      await api.deleteToken(ORG, BRAND, 'a/b', 1)
      expect(calls[0]?.path).toBe(`${TOKENS}/..%2Fx%3Fy%23z`)
      expect(calls[1]?.path).toBe(`${TOKENS}/a%2Fb?expectedVersion=1`)
    })

    it('validateDraft is a GET under the brand, not under /tokens', async () => {
      const reply = { draftRevision: 3, publishable: true, issues: [] }
      const { api, calls } = recorder(reply)
      expect(await api.validateDraft(ORG, BRAND)).toEqual(reply)
      expect(calls).toEqual([
        { method: 'GET', path: `/api/orgs/${ORG}/brands/${BRAND}/validate` },
      ])
    })

    it('importTokens POSTs exactly {tree, expectedRevision}', async () => {
      const { api, calls } = recorder({
        draftRevision: 5,
        count: 2,
        warnings: [],
      })
      await api.importTokens(ORG, BRAND, {
        tree: { primitive: {} },
        expectedRevision: 4,
        // @ts-expect-error a stray property must never reach the strict API body
        extra: true,
      })
      expect(calls).toEqual([
        {
          method: 'POST',
          path: `${TOKENS}/import`,
          body: { tree: { primitive: {} }, expectedRevision: 4 },
        },
      ])
    })
  })
})
